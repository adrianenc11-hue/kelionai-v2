#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runEnvAudit } = require('../src/services/envAudit');

function printLine(label, value) {
  if (value !== undefined && value !== null && value !== '') {
    console.log(`   ${label}: ${value}`);
  }
}

async function runAll() {
  console.log('\n=== KELION ENVIRONMENT AUDIT ===\n');
  const audit = await runEnvAudit();

  for (const r of audit.results) {
    const status = r.ok ? 'OK' : 'FAIL';
    const required = r.requiredForAutonomy ? ' [autonomy]' : '';
    console.log(`${status} ${r.name}${required}`);
    printLine('Status', r.status);
    printLine('Value', r.value);
    if (r.backend || r.frontend) {
      printLine('Backend', r.backend || 'missing');
      printLine('Frontend', r.frontend || 'missing');
    }
    if (r.session || r.jwt) {
      printLine('SESSION_SECRET', r.session || 'missing');
      printLine('JWT_SECRET', r.jwt || 'missing');
    }
    printLine('Note', r.note);
    printLine('Error', r.error);
    console.log('');
  }

  console.log(`=== RESULT: ${audit.total - audit.fail}/${audit.total} OK ===`);
  console.log(`=== AUTONOMY: ${audit.autonomy.total - audit.autonomy.fail}/${audit.autonomy.total} READY ===`);

  if (!audit.autonomy.ready) {
    console.log('\nAutonomy blockers:');
    for (const b of audit.autonomy.blockers) {
      console.log(`- ${b.name}: ${b.error}`);
    }
  }

  process.exit(audit.fail > 0 ? 1 : 0);
}

runAll().catch((err) => {
  console.error('Env audit failed:', err && err.message ? err.message : err);
  process.exit(1);
});
