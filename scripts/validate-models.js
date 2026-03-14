#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// KelionAI — Model Validation Script
// Run before deploy to ensure GLB models have required morph targets
// Usage: node scripts/validate-models.js
// ═══════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, '..', 'app', 'models');

const REQUIRED_MORPHS = ['jawOpen', 'mouthSmile', 'browInner', 'eyeSquint', 'noseSneer'];
const REQUIRED_VISEMES = [
  'viseme_aa',
  'viseme_CH',
  'viseme_DD',
  'viseme_E',
  'viseme_FF',
  'viseme_I',
  'viseme_kk',
  'viseme_nn',
  'viseme_O',
  'viseme_PP',
  'viseme_RR',
  'viseme_sil',
  'viseme_SS',
  'viseme_TH',
  'viseme_U',
];

const AVATARS = [
  { name: 'Kelion (male)', file: 'k-male.glb' },
  { name: 'Kira (female)', file: 'k-female.glb' },
];

let hasErrors = false;

for (const avatar of AVATARS) {
  const filePath = path.join(MODELS_DIR, avatar.file);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ ${avatar.name}: File missing — ${avatar.file}`);
    hasErrors = true;
    continue;
  }

  const buf = fs.readFileSync(filePath);
  const text = buf.toString('ascii');
  const size = (buf.length / 1024 / 1024).toFixed(1);

  // Check expressions
  const missingMorphs = REQUIRED_MORPHS.filter((m) => !text.includes(m));
  // Check visemes
  const missingVisemes = REQUIRED_VISEMES.filter((m) => !text.includes(m));
  // Count total found
  const allRequired = [...REQUIRED_MORPHS, ...REQUIRED_VISEMES];
  const found = allRequired.filter((m) => text.includes(m));

  if (missingMorphs.length > 0 || missingVisemes.length > 0) {
    console.error(`⚠️  ${avatar.name} (${avatar.file}, ${size}MB): ${found.length}/${allRequired.length} morphs`);
    if (missingMorphs.length > 0) {
      console.error(`   Missing expressions: ${missingMorphs.join(', ')}`);
    }
    if (missingVisemes.length > 0) {
      console.error(`   Missing visemes: ${missingVisemes.join(', ')}`);
      console.error(`   ⚠️  Lip sync will use FALLBACK (text-based) instead of FFT visemes`);
    }
    hasErrors = true;
  } else {
  }
}

if (hasErrors) {
  process.exit(1);
} else {
  process.exit(0);
}
