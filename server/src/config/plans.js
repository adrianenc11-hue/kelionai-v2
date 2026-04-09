'use strict';

/**
 * Subscription plan definitions.
 * Each plan specifies daily usage limits and pricing info.
 */
const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'USD',
    interval: null,
    dailyLimit: 10,
    features: [
      '10 voice generations/day',
      'Basic AI assistants (Kelion & Kira)',
      'Text & voice chat',
    ],
  },
  basic: {
    id: 'basic',
    name: 'Basic',
    price: 9.99,
    currency: 'USD',
    interval: 'month',
    dailyLimit: 100,
    features: [
      '100 voice generations/day',
      'All AI assistants',
      'Priority responses',
      'Email support',
    ],
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    price: 29.99,
    currency: 'USD',
    interval: 'month',
    dailyLimit: 1000,
    features: [
      '1 000 voice generations/day',
      'All AI assistants',
      'Priority responses',
      'Custom avatar settings',
      'Priority support',
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 99.99,
    currency: 'USD',
    interval: 'month',
    dailyLimit: Infinity,
    features: [
      'Unlimited voice generations',
      'All AI assistants',
      'Dedicated support',
      'Custom integrations',
      'SLA guarantee',
    ],
  },
};

const VALID_TIERS    = Object.keys(PLANS);
const VALID_STATUSES = ['active', 'cancelled', 'expired', 'trial'];

module.exports = { PLANS, VALID_TIERS, VALID_STATUSES };
