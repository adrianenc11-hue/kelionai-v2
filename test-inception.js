require('dotenv').config();
const { KelionBrain } = require('./server/brain');

async function testInception() {
  console.log('🧠 Inception Faza 3.5 Test...');
  const brain = new KelionBrain({ geminiKey: 'test', supabase: null });

  // Așteptăm să se inițializeze constructorul (Knowledge base)
  await new Promise((r) => setTimeout(r, 2000));

  console.log('\n--- 1. Test Knowledge Base ---');
  const kb = brain._readKnowledge();
  console.log(JSON.stringify(kb, null, 2));

  console.log('\n--- 2. Test Logs (Health) ---');
  const logs = brain._readLogs('health');
  console.log(JSON.stringify(logs, null, 2));

  console.log('\n--- 3. Test Diagnose (Simulat) ---');
  const diag = await brain._diagnoseError('fake_error_test', 'server/brain.js');
  console.log('Diagnostic găsite:', diag.analysis.length);

  process.exit(0);
}

testInception();
