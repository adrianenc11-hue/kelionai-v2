require('dotenv').config();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Copy pasting callAIProvider so it works standalone
async function callAIProvider(provider, system, message) {
  var key, url, body, headers;
  switch (provider) {
    case 'groq':
      key = process.env.GROQ_API_KEY;
      url = 'https://api.groq.com/openai/v1/chat/completions';
      body = JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: message },
        ],
      });
      headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
      break;
    case 'deepseek':
      key = process.env.DEEPSEEK_API_KEY;
      url = 'https://api.deepseek.com/chat/completions';
      body = JSON.stringify({
        model: 'deepseek-coder',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: message },
        ],
      });
      headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
      break;
    case 'claude-haiku':
      key = process.env.ANTHROPIC_API_KEY;
      url = 'https://api.anthropic.com/v1/messages';
      body = JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 2000,
        system: system,
        messages: [{ role: 'user', content: message }],
      });
      headers = { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
      break;
    case 'gpt54':
      key = process.env.OPENAI_API_KEY;
      url = 'https://api.openai.com/v1/chat/completions';
      body = JSON.stringify({
        model: 'gpt-5.4',
        max_completion_tokens: 2000,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: message },
        ],
      });
      headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
      break;
  }
  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(provider + ' e ' + res.status + ' ' + (await res.text()));
  const d = await res.json();
  return d.choices ? d.choices[0].message.content : d.content[0].text;
}

async function testRepair() {
  console.log('--- START ---');
  let fileContent = fs.readFileSync('app/js/fft-lipsync.js', 'utf8');
  let diag = await callAIProvider(
    'groq',
    'Esti diagnostic AI. Fii FOARTE succint.',
    'Analizeaza app/js/fft-lipsync.js pentru problema: "valori MAX_VISEME si MAX_VISEME_AA prea mari". Cod: ' +
      fileContent.substring(0, 3000)
  );
  console.log('Groq:', diag.slice(0, 100));

  let prop = await callAIProvider(
    'deepseek',
    'Esti senior dev.',
    'Problema: gura se deschide prea mult. Corecteaza valorile MAX_VISEME si MAX_VISEME_AA in functie de cod si diagnostic: ' +
      diag
  );
  console.log('DeepSeek:', prop.slice(0, 100));

  let execPrompt =
    'Modifica valorile conform cerintei din plan:\n' +
    prop +
    '\nCod vechi:\n' +
    fileContent.substring(0, 2000) +
    '\n\nGENEREAZA JSON pentru {tool:"editFile", params:{filePath, target, replacement}}!!';
  let execResult = await callAIProvider('gpt54', 'Esti executant. Iesi doar JSON. Fara alte texte!', execPrompt);
  console.log('GPT-5.4 Result:', execResult);
}
testRepair().catch(console.error);
