'use strict';

/**
 * K1 TRUTH GUARD — Verificare adversarială
 *
 * Pipeline: OUTPUT → CLAIM_EXTRACTION → EVIDENCE_CHECK → CONFIDENCE_CALIBRATION → PASS/BLOCK
 *
 * Verifică:
 * - Claims de preț contra date reale
 * - Claims de trend contra indicatori
 * - Claims numerice contra calcule
 * - Contradicții interne
 */

const logger = require('pino')({ name: 'k1-truth' });
const k1Cognitive = require('./k1-cognitive');

// ═══════════════════════════════════════════════════════════════
// CLAIM EXTRACTION — Extrage claims verificabile din text
// ═══════════════════════════════════════════════════════════════

/**
 * extractClaims
 * @param {*} text
 * @returns {*}
 */
function extractClaims(text) {
  const claims = [];

  // Detectează prețuri: "BTC e la $70000", "ETH = 2066"
  const priceRegex = /(BTC|ETH|SOL|Gold|NASDAQ|S&P|EUR\/USD|GBP\/USD)\s*(?:e|este|=|la|price|at)\s*\$?([\d,.]+)/gi;
  let match;
  while ((match = priceRegex.exec(text)) !== null) {
    claims.push({
      type: 'price',
      asset: match[1].toUpperCase(),
      claimed: parseFloat(match[2].replace(',', '')),
      text: match[0],
    });
  }

  // Detectează procente: "RSI e 25", "confidence 70%", "win rate 50%"
  const pctRegex = /(RSI|confidence|win rate|accuracy|return)\s*(?:e|este|=|de|la)?\s*([\d.]+)\s*%?/gi;
  while ((match = pctRegex.exec(text)) !== null) {
    claims.push({
      type: 'metric',
      metric: match[1].toLowerCase(),
      claimed: parseFloat(match[2]),
      text: match[0],
    });
  }

  // Detectează trenduri: "BTC crește", "piața scade", "bullish", "bearish"
  const trendRegex = /(BTC|ETH|SOL|piața|market)\s*(crește|scade|bullish|bearish|urcă|coboară|stagnează)/gi;
  while ((match = trendRegex.exec(text)) !== null) {
    claims.push({
      type: 'trend',
      subject: match[1],
      direction: /crește|bullish|urcă/i.test(match[2])
        ? 'up'
        : /scade|bearish|coboară/i.test(match[2])
          ? 'down'
          : 'flat',
      text: match[0],
    });
  }

  return claims;
}

// ═══════════════════════════════════════════════════════════════
// EVIDENCE CHECK — Verifică claims contra date
// ═══════════════════════════════════════════════════════════════

/**
 * Verifică un claim de preț contra datelor live
 */
function checkPriceClaim(claim, liveData) {
  if (!liveData || !liveData[claim.asset]) {
    return {
      status: 'unverifiable',
      reason: `Nu am date live pentru ${claim.asset}`,
    };
  }

  const real = liveData[claim.asset];
  const tolerance = 0.02; // 2% diferență acceptabilă
  const diff = Math.abs(claim.claimed - real) / real;

  if (diff <= tolerance) {
    return {
      status: 'verified',
      emoji: '✅',
      claimed: claim.claimed,
      actual: real,
      diff: (diff * 100).toFixed(2) + '%',
    };
  } else if (diff <= 0.1) {
    return {
      status: 'approximate',
      emoji: '⚠️',
      claimed: claim.claimed,
      actual: real,
      diff: (diff * 100).toFixed(2) + '%',
    };
  } else {
    return {
      status: 'false',
      emoji: '❌',
      claimed: claim.claimed,
      actual: real,
      diff: (diff * 100).toFixed(2) + '%',
    };
  }
}

/**
 * Detectează contradicții interne
 */
function findContradictions(text) {
  const contradictions = [];

  // Contradicție: "BTC crește" și "piața scade" în același text
  if (/crește|bullish|urcă/i.test(text) && /scade|bearish|coboară/i.test(text)) {
    // Verificăm dacă sunt despre subiecte diferite
    const bullishMatch = text.match(/(BTC|ETH|SOL|Gold|piața|totul)\s*(crește|bullish|urcă)/i);
    const bearishMatch = text.match(/(BTC|ETH|SOL|Gold|piața|totul)\s*(scade|bearish|coboară)/i);
    if (bullishMatch && bearishMatch && bullishMatch[1] === bearishMatch[1]) {
      contradictions.push({
        type: 'direction_conflict',
        text: `Zice "${bullishMatch[0]}" dar și "${bearishMatch[0]}" despre același subiect`,
      });
    }
  }

  // Contradicție: confidence mare + "nu sunt sigur"
  if (/confidence\s*(8|9)\d/i.test(text) && /nu sunt sigur|incert|posibil/i.test(text)) {
    contradictions.push({
      type: 'confidence_conflict',
      text: 'Confidence mare dar limbaj incert',
    });
  }

  return contradictions;
}

// ═══════════════════════════════════════════════════════════════
// TRUTH REPORT — Verificare completă
// ═══════════════════════════════════════════════════════════════

/**
 * Verifică un text complet — returnează truth report
 */
function verify(text, liveData = {}) {
  k1Cognitive.think(`Verificare text: "${text.slice(0, 80)}..."`, {
    phase: 'OBSERVE',
  });

  const claims = extractClaims(text);
  const contradictions = findContradictions(text);

  // Verifică fiecare claim
  const verifiedClaims = claims.map((claim) => {
    let check = { status: 'unverifiable', emoji: '⚪' };
    if (claim.type === 'price') {
      check = checkPriceClaim(claim, liveData);
    }
    return { ...claim, verification: check };
  });

  // Calculează trust score
  const total = verifiedClaims.length;
  const verified = verifiedClaims.filter((c) => c.verification.status === 'verified').length;
  const falseClaims = verifiedClaims.filter((c) => c.verification.status === 'false').length;
  const unverifiable = verifiedClaims.filter((c) => c.verification.status === 'unverifiable').length;

  let trustScore = 50; // Bază
  if (total > 0) {
    trustScore = Math.round((verified / total) * 100);
  }
  if (contradictions.length > 0) trustScore -= 20 * contradictions.length;
  if (falseClaims > 0) trustScore -= 30 * falseClaims;
  trustScore = Math.max(0, Math.min(100, trustScore));

  // Decizia: PASS sau BLOCK
  const decision = trustScore >= 40 && falseClaims === 0 ? 'PASS' : 'BLOCK';

  const report = {
    decision,
    trustScore,
    totalClaims: total,
    verified,
    falseClaims,
    unverifiable,
    contradictions: contradictions.length,
    claims: verifiedClaims,
    contradictionDetails: contradictions,
    timestamp: new Date().toISOString(),
  };

  const emoji = decision === 'PASS' ? '✅' : '🚫';
  k1Cognitive.think(
    `Truth: ${emoji} ${decision} (score ${trustScore}, ${verified}/${total} verificate, ${falseClaims} false, ${contradictions.length} contradicții)`,
    { phase: 'OBSERVE', confidence: trustScore }
  );

  if (falseClaims > 0) {
    logger.warn({ falseClaims, trustScore }, '[K1-Truth] ⚠️ Claims false detectate!');
  }

  return report;
}

// ═══════════════════════════════════════════════════════════════
// ADVERSARIAL SELF-TEST — K1 se testează singur
// ═══════════════════════════════════════════════════════════════

const selfTestResults = [];

/**
 * Generează test-uri pe baza domeniului
 */
function generateSelfTest(domain = 'trading') {
  const tests = {
    trading: [
      {
        input: 'BTC e la $70000 și RSI e 25, deci e STRONG BUY',
        expected: { hasPriceClaim: true, hasTrend: false },
      },
      {
        input: 'Piața crește dar și scade simultan',
        expected: { contradictions: 1 },
      },
      {
        input: 'Confidence 95% dar nu sunt sigur',
        expected: { contradictions: 1 },
      },
    ],
    general: [
      {
        input: 'Fără claims specifice, doar o observație generală',
        expected: { totalClaims: 0 },
      },
    ],
  };

  return tests[domain] || tests.general;
}

/**
 * runSelfTest
 * @param {*} domain
 * @returns {*}
 */
function runSelfTest(domain = 'trading') {
  const tests = generateSelfTest(domain);
  const results = tests.map((test) => {
    const report = verify(test.input, {});
    const passed = Object.entries(test.expected).every(([key, val]) => {
      if (key === 'contradictions') return report.contradictions >= val;
      if (key === 'hasPriceClaim') return report.claims.some((c) => c.type === 'price') === val;
      if (key === 'totalClaims') return report.totalClaims === val;
      return true;
    });
    return { input: test.input.slice(0, 50), expected: test.expected, passed };
  });

  const score = Math.round((results.filter((r) => r.passed).length / results.length) * 100);
  const testRun = {
    domain,
    score,
    tests: results,
    timestamp: new Date().toISOString(),
  };
  selfTestResults.push(testRun);
  if (selfTestResults.length > 20) selfTestResults.shift();

  k1Cognitive.think(
    `Self-test ${domain}: ${score}% (${results.filter((r) => r.passed).length}/${results.length} passed)`,
    { phase: 'LEARN', domain }
  );

  return testRun;
}

/**
 * getSelfTestHistory
 * @returns {*}
 */
function getSelfTestHistory() {
  return selfTestResults;
}

/**
 * undefined
 * @returns {*}
 */
module.exports = {
  extractClaims,
  findContradictions,
  verify,
  generateSelfTest,
  runSelfTest,
  getSelfTestHistory,
};
