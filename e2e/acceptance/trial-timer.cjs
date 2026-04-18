#!/usr/bin/env node
'use strict';

/**
 * ACCEPTANCE: trial-timer — OUT OF SCOPE in Kelion (Stages 1–6).
 *
 * Context: the trial-timer capability tested the "15-minute guest trial"
 * flow of the old kelionai.app product. The Kelion rebuild removed the
 * subscription and trial UI entirely (see DELIVERY_CONTRACT.md § Out of
 * scope). There is no timer, no trial, no signed-out countdown.
 *
 * This script exits 0 because the capability is explicitly deleted from
 * the product, not because it "works". It is kept as a stub only so the
 * acceptance matrix in .github/workflows/acceptance.yml continues to
 * report a status to GitHub branch protection, which still lists the job
 * as required.
 *
 * Per RULES.md §2 (Rule of Honesty), this stub does NOT claim the trial
 * feature is verified. It claims the feature does not exist.
 */

console.log('[acceptance:trial-timer] OUT OF SCOPE — feature removed from product in Kelion rebuild.');
console.log('[acceptance:trial-timer] See DELIVERY_CONTRACT.md § Capabilities deliberately out of scope.');
process.exit(0);
