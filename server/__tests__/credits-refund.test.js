'use strict';

/**
 * Audit M3 — unit coverage for the Stripe `charge.refunded` handler.
 *
 * We drive `handleChargeRefunded` directly (exposed on the credits
 * router module) and assert it:
 *   - inverts full-refund minutes 1:1
 *   - prorates partial refunds (floored, never above the original)
 *   - no-ops on unknown PaymentIntents
 *   - passes allowNegative through so already-spent balances settle
 *   - uses the Refund ID as idempotency_key so retries collapse
 *   - uses the most-recent refund when multiple exist on one charge
 *   - tolerates missing / malformed event shapes
 */

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';

jest.mock('../src/db', () => {
  const addCreditsTransaction = jest.fn(() => Promise.resolve({
    balance: 42, previous: 0, deltaMinutes: -1,
  }));
  const getCreditTopupByPaymentIntent = jest.fn();
  return {
    addCreditsTransaction,
    getCreditTopupByPaymentIntent,
    getCreditsBalance: jest.fn(() => Promise.resolve(0)),
    listCreditTransactions: jest.fn(() => Promise.resolve([])),
  };
});

const db = require('../src/db');
const { handleChargeRefunded } = require('../src/routes/credits');

function buildEvent({ refunds, amount = 1000, pi = 'pi_1' } = {}) {
  return {
    id: 'evt_refund_1',
    type: 'charge.refunded',
    data: {
      object: {
        id: 'ch_1',
        amount,
        amount_refunded: amount,
        currency: 'gbp',
        payment_intent: pi,
        refunded: true,
        refunds: { data: refunds },
      },
    },
  };
}

function topup({
  id = 101, user_id = 1, delta_minutes = 33, amount_cents = 1000,
  stripe_payment_intent = 'pi_1',
} = {}) {
  return {
    id, user_id, delta_minutes, amount_cents,
    currency: 'gbp',
    stripe_session_id: 'cs_1',
    stripe_payment_intent,
    idempotency_key: null,
    kind: 'topup',
    note: 'package:standard',
    created_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  db.addCreditsTransaction.mockClear();
  db.getCreditTopupByPaymentIntent.mockReset();
});

describe('handleChargeRefunded', () => {
  it('inverts full-refund minutes 1:1 with refund.id as idempotency key', async () => {
    db.getCreditTopupByPaymentIntent.mockResolvedValue(topup());
    const event = buildEvent({
      refunds: [{ id: 're_1', amount: 1000, currency: 'gbp', created: 100 }],
    });

    await handleChargeRefunded(event);

    expect(db.addCreditsTransaction).toHaveBeenCalledTimes(1);
    const call = db.addCreditsTransaction.mock.calls[0][0];
    expect(call).toMatchObject({
      userId: 1,
      deltaMinutes: -33,
      kind: 'refund',
      stripePaymentIntent: 'pi_1',
      idempotencyKey: 're_1',
      allowNegative: true,
    });
    expect(call.amountCents).toBe(-1000);
  });

  it('prorates partial refunds (floored to avoid over-crediting)', async () => {
    db.getCreditTopupByPaymentIntent.mockResolvedValue(topup({ delta_minutes: 100, amount_cents: 3000 }));
    const event = buildEvent({
      amount: 3000,
      refunds: [{ id: 're_partial', amount: 999, currency: 'gbp', created: 200 }],
    });

    await handleChargeRefunded(event);

    const call = db.addCreditsTransaction.mock.calls[0][0];
    // 100 * 999 / 3000 = 33.3 → floor → 33
    expect(call.deltaMinutes).toBe(-33);
    expect(call.idempotencyKey).toBe('re_partial');
  });

  it('clamps revert minutes to the original top-up on Stripe rounding quirks', async () => {
    db.getCreditTopupByPaymentIntent.mockResolvedValue(topup({ delta_minutes: 10, amount_cents: 1000 }));
    // Pathological: refund cents exceed original (shouldn't happen in
    // practice but guards against bad data).
    const event = buildEvent({
      amount: 1000,
      refunds: [{ id: 're_over', amount: 9999, currency: 'gbp', created: 1 }],
    });

    await handleChargeRefunded(event);

    const call = db.addCreditsTransaction.mock.calls[0][0];
    expect(call.deltaMinutes).toBe(-10);
  });

  it('refunds at least 1 minute even on sub-proportional dust refunds', async () => {
    db.getCreditTopupByPaymentIntent.mockResolvedValue(topup({ delta_minutes: 33, amount_cents: 1000 }));
    const event = buildEvent({
      refunds: [{ id: 're_dust', amount: 1, currency: 'gbp', created: 1 }],
    });

    await handleChargeRefunded(event);

    const call = db.addCreditsTransaction.mock.calls[0][0];
    expect(call.deltaMinutes).toBe(-1);
  });

  it('picks the most-recent refund when multiple partials exist on one charge', async () => {
    db.getCreditTopupByPaymentIntent.mockResolvedValue(topup({ delta_minutes: 100, amount_cents: 10000 }));
    const event = buildEvent({
      amount: 10000,
      refunds: [
        { id: 're_older', amount: 2000, currency: 'gbp', created: 100 },
        { id: 're_newest', amount: 3000, currency: 'gbp', created: 300 },
        { id: 're_middle', amount: 1000, currency: 'gbp', created: 200 },
      ],
    });

    await handleChargeRefunded(event);

    const call = db.addCreditsTransaction.mock.calls[0][0];
    expect(call.idempotencyKey).toBe('re_newest');
    // 100 * 3000 / 10000 = 30
    expect(call.deltaMinutes).toBe(-30);
  });

  it('no-ops when PaymentIntent has no matching top-up', async () => {
    db.getCreditTopupByPaymentIntent.mockResolvedValue(null);
    const event = buildEvent({
      refunds: [{ id: 're_x', amount: 500, currency: 'gbp', created: 1 }],
    });

    await handleChargeRefunded(event);

    expect(db.addCreditsTransaction).not.toHaveBeenCalled();
  });

  it('no-ops when charge has no payment_intent', async () => {
    const event = buildEvent({
      refunds: [{ id: 're_1', amount: 500, currency: 'gbp', created: 1 }],
      pi: null,
    });
    // Overwrite explicitly — buildEvent sets pi on object.
    event.data.object.payment_intent = null;

    await handleChargeRefunded(event);

    expect(db.getCreditTopupByPaymentIntent).not.toHaveBeenCalled();
    expect(db.addCreditsTransaction).not.toHaveBeenCalled();
  });

  it('no-ops when event has no charge object', async () => {
    await handleChargeRefunded({ id: 'evt_empty', type: 'charge.refunded', data: {} });
    expect(db.addCreditsTransaction).not.toHaveBeenCalled();
  });

  it('no-ops when original top-up has zero amount_cents (grant/legacy row)', async () => {
    db.getCreditTopupByPaymentIntent.mockResolvedValue(topup({ amount_cents: 0 }));
    const event = buildEvent({
      refunds: [{ id: 're_free', amount: 1000, currency: 'gbp', created: 1 }],
    });

    await handleChargeRefunded(event);

    expect(db.addCreditsTransaction).not.toHaveBeenCalled();
  });

  it('no-ops when refunds.data is missing or empty', async () => {
    db.getCreditTopupByPaymentIntent.mockResolvedValue(topup());
    const event = buildEvent({ refunds: [] });

    await handleChargeRefunded(event);
    expect(db.addCreditsTransaction).not.toHaveBeenCalled();

    const noData = buildEvent({ refunds: [{ id: 're_1', amount: 100, created: 1 }] });
    noData.data.object.refunds = null;
    await handleChargeRefunded(noData);
    expect(db.addCreditsTransaction).not.toHaveBeenCalled();
  });

  it('no-ops when refund entry is missing id or amount', async () => {
    db.getCreditTopupByPaymentIntent.mockResolvedValue(topup());
    await handleChargeRefunded(buildEvent({
      refunds: [{ amount: 500, currency: 'gbp', created: 1 }], // missing id
    }));
    await handleChargeRefunded(buildEvent({
      refunds: [{ id: 're_zero', amount: 0, currency: 'gbp', created: 1 }],
    }));
    expect(db.addCreditsTransaction).not.toHaveBeenCalled();
  });

  it('treats a duplicate webhook replay as idempotent (downstream UNIQUE kicks in)', async () => {
    db.getCreditTopupByPaymentIntent.mockResolvedValue(topup());
    // Simulate the UNIQUE(idempotency_key) path inside addCreditsTransaction
    // that returns duplicate:true on replay.
    db.addCreditsTransaction.mockResolvedValueOnce({ balance: 33, previous: 33, deltaMinutes: 0, duplicate: true });
    const event = buildEvent({
      refunds: [{ id: 're_replay', amount: 1000, currency: 'gbp', created: 1 }],
    });

    await expect(handleChargeRefunded(event)).resolves.toBeUndefined();
    expect(db.addCreditsTransaction).toHaveBeenCalledTimes(1);
  });

  it('passes refund.currency through (falls back to top-up currency, then gbp)', async () => {
    db.getCreditTopupByPaymentIntent.mockResolvedValue(topup({ amount_cents: 2000 }));
    const event = buildEvent({
      amount: 2000,
      refunds: [{ id: 're_eur', amount: 1000, currency: 'EUR', created: 1 }],
    });

    await handleChargeRefunded(event);

    const call = db.addCreditsTransaction.mock.calls[0][0];
    expect(call.currency).toBe('eur');
  });
});
