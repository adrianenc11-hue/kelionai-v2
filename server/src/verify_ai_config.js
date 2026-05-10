
const config = require('./config');
const { getAdminEmails } = require('./config');

console.log('--- KELION AI CONFIG VERIFICATION ---');
console.log('Node Env:', config.nodeEnv);
console.log('Chat Model:', config.google.chatModel);
console.log('Live Model:', config.google.liveModel);
console.log('TTS Model:', config.google.ttsModel);
console.log('Google API Key Set:', !!config.google.apiKey);
console.log('OpenRouter Key Set:', !!process.env.OPENROUTER_API_KEY);
console.log('Admin Emails:', getAdminEmails());

if (config.google.chatModel.includes('gemini') && config.google.chatModel.includes('free')) {
  console.log('SUCCESS: Default model is set to FREE Gemini.');
} else {
  console.log('WARNING: Default model is NOT set to free Gemini.');
}

// Check if direct Google routing logic is sound (mocking a request)
const model = config.google.chatModel;
const googleKey = config.google.apiKey || 'test_key';
const isGoogleModel = model.startsWith('google/');

if (googleKey && isGoogleModel) {
  const modelSlug = model.replace('google/', '').replace(':free', '');
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;
  console.log('ROUTING VERIFICATION: Direct Google API will be used.');
  console.log('Target URL:', apiUrl);
} else {
  console.log('ROUTING VERIFICATION: Falling back to OpenRouter.');
}

console.log('--- END VERIFICATION ---');
