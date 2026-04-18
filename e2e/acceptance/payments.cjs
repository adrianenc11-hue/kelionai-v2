#!/usr/bin/env node
'use strict';

/**
 * ACCEPTANCE: payments — OUT OF SCOPE in Kelion (Stages 1–6).
 *
 * The Kelion rebuild removed all payment, subscription and Stripe UI
 * (see DELIVERY_CONTRACT.md § Out of scope). No checkout, no plan picker,
 * no subscription state in the UI.
 *
 * Stub kept so GitHub branch protection's required `acceptance (payments)`
 * check still receives a status. Per RULES.md §2 this is NOT a claim that
 * payments work — it is a claim that payments are deliberately absent.
 */

console.log('[acceptance:payments] OUT OF SCOPE — payment/subscription UI removed in Kelion rebuild.');
console.log('[acceptance:payments] See DELIVERY_CONTRACT.md § Capabilities deliberately out of scope.');
process.exit(0);
