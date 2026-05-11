
const config = require('./config');
const { getAdminEmails } = require('./config');
const { MODELS, getModel, getFallbackChain } = require('./services/modelRouter');

console.log('--- KELION AI CONFIG VERIFICATION ---');
console.log('Node Env:', config.nodeEnv);
console.log('');

// Smart Model Router
console.log('=== SMART MODEL ROUTER ===');
console.log('Chat (main brain):', MODELS.chat);
console.log('Coder (expert):', MODELS.coder);
console.log('Vision (camera):', MODELS.vision);
console.log('');

// Fallback chains
console.log('=== FALLBACK CHAINS ===');
console.log('Chat fallbacks:', getFallbackChain('chat').join(' → '));
console.log('Coder fallbacks:', getFallbackChain('coder').join(' → '));
console.log('Vision fallbacks:', getFallbackChain('vision').join(' → '));
console.log('');

// Config.js legacy models
console.log('=== CONFIG.JS DEFAULTS ===');
console.log('Chat Model:', config.google.chatModel);
console.log('Live Model:', config.google.liveModel);
console.log('TTS Model:', config.google.ttsModel);
console.log('Free Mode:', config.google.freeMode);
console.log('');

// API Keys
console.log('=== API KEYS ===');
console.log('Google API Key Set:', !!config.google.apiKey);
console.log('OpenRouter Key Set:', !!process.env.OPENROUTER_API_KEY);
console.log('Admin Emails:', getAdminEmails());
console.log('');

// Verify all models are :free (zero cost)
const allModels = [MODELS.chat, MODELS.coder, MODELS.vision];
const allFree = allModels.every(m => m.includes(':free'));
if (allFree) {
  console.log('✅ SUCCESS: All models are FREE. Zero cost operation.');
} else {
  const paid = allModels.filter(m => !m.includes(':free'));
  console.log('⚠️ WARNING: Some models are NOT free:', paid.join(', '));
}

console.log('--- END VERIFICATION ---');
