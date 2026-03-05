#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// KelionAI — Smoke Probe
// Quick health checks for critical endpoints.
// Requires BASE_URL or API_BASE_URL env var.
// Exit 0 = all probes pass. Non-zero = at least one failed.
// ═══════════════════════════════════════════════════════════════
"use strict";

const BASE =
  process.env.BASE_URL || process.env.API_BASE_URL || "https://kelionai.app";

const PROBES = [
  {
    path: "/health",
    expectStatus: 200,
    expectJson: true,
    checkField: "status",
  },
  {
    path: "/api/payments/plans",
    expectStatus: 200,
    expectJson: true,
    checkField: "plans",
  },
  { path: "/api/news/public", expectStatus: 200, expectJson: true },
];

async function probe({ path, expectStatus, expectJson, checkField }) {
  const url = `${BASE}${path}`;
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const duration = Date.now() - start;

    if (res.status !== expectStatus) {
      console.log(
        `❌ ${path} → ${res.status} (expected ${expectStatus}) [${duration}ms]`,
      );
      return false;
    }

    if (expectJson) {
      const data = await res.json();
      if (checkField && !(checkField in data)) {
        console.log(
          `❌ ${path} → 200 but missing "${checkField}" field [${duration}ms]`,
        );
        return false;
      }
    }

    console.log(`✅ ${path} → ${res.status} [${duration}ms]`);
    return true;
  } catch (e) {
    const duration = Date.now() - start;
    console.log(`❌ ${path} → FAIL: ${e.message} [${duration}ms]`);
    return false;
  }
}

(async () => {
  console.log(`\n🔍 Smoke Probe — ${BASE}\n`);
  const results = await Promise.all(PROBES.map(probe));
  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n${passed}/${total} probes passed.`);
  process.exit(passed === total ? 0 : 1);
})();
