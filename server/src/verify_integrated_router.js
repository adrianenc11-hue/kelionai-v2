'use strict';

const { smartFetch, MODELS, OPENROUTER_FALLBACK } = require('./services/modelRouter');
require('dotenv').config({ path: './server/.env' });

async function runTests() {
  console.log('=== KELION INTEGRATED ROUTER AUDIT ===');
  console.log('Testing each route for live response and fallback...');

  const testMessages = [{ role: 'user', content: 'Say "READY"' }];

  // 1. Chat Test
  try {
    console.log('\n[TEST 1] Chat Route...');
    const result = await smartFetch('chat', { messages: testMessages });
    const data = await result.response.json();
    console.log('✅ Chat OK:', result.model, 'via', result.provider);
    console.log('Response excerpt:', data.choices?.[0]?.message?.content?.slice(0, 50));
  } catch (err) {
    console.error('❌ Chat FAILED:', err.message);
  }

  // 2. Coder Test
  try {
    console.log('\n[TEST 2] Coder Route...');
    const result = await smartFetch('coder', { messages: [{ role: 'user', content: 'Write a hello world in JS' }] });
    const data = await result.response.json();
    console.log('✅ Coder OK:', result.model, 'via', result.provider);
  } catch (err) {
    console.error('❌ Coder FAILED:', err.message);
  }

  // 3. Vision/Extraction Test
  try {
    console.log('\n[TEST 3] Vision/Extraction Route...');
    // We use a simple text prompt to verify the model ID is valid for chat completions
    const result = await smartFetch('vision', { messages: testMessages });
    const data = await result.response.json();
    console.log('✅ Vision/Extraction OK:', result.model, 'via', result.provider);
  } catch (err) {
    console.error('❌ Vision/Extraction FAILED:', err.message);
  }

  // 4. Fallback Chain Validation
  console.log('\n[TEST 4] Fallback Chain ID Validation...');
  const allIds = [
    ...Object.values(MODELS),
    ...Object.values(OPENROUTER_FALLBACK).flat()
  ];
  const uniqueIds = [...new Set(allIds)].filter(id => !id.startsWith('gemini'));

  console.log('Verifying these IDs with OpenRouter:', uniqueIds);
  
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    const data = await res.json();
    const activeIds = data.data.map(m => m.id);
    
    for (const id of uniqueIds) {
      if (activeIds.includes(id)) {
        console.log('✅ Valid ID:', id);
      } else {
        console.error('❌ INVALID ID:', id, '(This will cause 400 errors)');
      }
    }
  } catch (err) {
    console.warn('⚠️ Could not verify IDs with OpenRouter API:', err.message);
  }

  console.log('\n=== AUDIT COMPLETE ===');
}

runTests().catch(err => {
  console.error('CRITICAL TEST ERROR:', err);
  process.exit(1);
});
