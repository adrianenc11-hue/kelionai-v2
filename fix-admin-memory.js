const fs = require('fs');
const path = require('path');

const targetFile = path.resolve(__dirname, 'server/routes/brain-chat.js');
let code = fs.readFileSync(targetFile, 'utf8');

// 1. Update callK1 signature
code = code.replace(
  'async function callK1(systemPrompt, userMessage) {',
  'async function callK1(systemPrompt, userMessage, historyArray = []) {'
);
code = code.replace(
  "    { name: 'Groq', fn: () => callAIProvider('groq', systemPrompt, userMessage) },",
  "    { name: 'Groq', fn: () => callAIProvider('groq', systemPrompt, userMessage, historyArray) },"
);
code = code.replace(
  "    { name: 'GPT-5.4', fn: () => callOpenAI(systemPrompt, userMessage) },",
  "    { name: 'GPT-5.4', fn: () => callOpenAI(systemPrompt, userMessage, historyArray) },"
);
code = code.replace(
  "    { name: 'gemini', fn: () => callGemini(systemPrompt, userMessage) },",
  "    { name: 'gemini', fn: () => callGemini(systemPrompt, userMessage, historyArray) },"
);

// 2. callOpenAI signature and messages
code = code.replace(
  'async function callOpenAI(system, message) {',
  'async function callOpenAI(system, message, historyArray = []) {'
);
code = code.replace(
  /messages:\s*\[[\s\S]*?\{ role: 'system', content: system \},[\s\S]*?\{ role: 'user', content: message \},[\s\S]*?\],/,
  "messages: [{ role: 'system', content: system }, ...historyArray, { role: 'user', content: message }],"
);

// 3. callGemini signature and contents
code = code.replace(
  'async function callGemini(system, message) {',
  'async function callGemini(system, message, historyArray = []) {'
);
code = code.replace(
  /contents:\s*\[\s*\{ parts: \[\{ text: message \}\]\s*\}\s*\]/,
  \`contents: [
          ...historyArray.map(h => ({
            role: h.role === 'user' ? 'user' : 'model',
            parts: [{ text: h.content }]
          })),
          { role: 'user', parts: [{ text: message }] }
        ]\`
);

// 4. callAIProvider signature and messages
code = code.replace(
  'async function callAIProvider(provider, system, message) {',
  'async function callAIProvider(provider, system, message, historyArray = []) {'
);
// replace messages in Groq
code = code.replace(
  /model:\s*'llama-3.3-70b-versatile',[\s\S]*?messages:\s*\[[\s\S]*?\{ role: 'system', content: system \},[\s\S]*?\{ role: 'user', content: message \},[\s\S]*?\],/g,
  \`model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: system }, ...historyArray, { role: 'user', content: message }],\`
);
// replace messages in Deepseek
code = code.replace(
  /model:\s*'deepseek-coder',[\s\S]*?messages:\s*\[[\s\S]*?\{ role: 'system', content: system \},[\s\S]*?\{ role: 'user', content: message \},[\s\S]*?\],/g,
  \`model: 'deepseek-coder',
        messages: [{ role: 'system', content: system }, ...historyArray, { role: 'user', content: message }],\`
);

// 5. Update router.post to extract array and pass empty string to getK1SystemPrompt
const postTarget = `
    const history = session.buildHistory(currentSession, 30);
    let systemPrompt = getK1SystemPrompt(knowledge, raport, history);
`;
const postReplacement = `
    const historyArray = currentSession.messages.slice(-30).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));
    // Pass empty string for text history, because we now pass the array natively via API!
    let systemPrompt = getK1SystemPrompt(knowledge, raport, '');
`;
code = code.replace(postTarget.trim(), postReplacement.trim());

// 6. Update callK1 invocation in router
code = code.replace(
  'let response = await callK1(systemPrompt, message);',
  'let response = await callK1(systemPrompt, message, historyArray);'
);
// Fix the retry generic call too
code = code.replace(
  'response = await callK1(force, message);',
  'response = await callK1(force, message, historyArray);'
);

fs.writeFileSync(targetFile, code, 'utf8');
console.log('brain-chat.js memory payload successfully injected natively into the APIs.');
