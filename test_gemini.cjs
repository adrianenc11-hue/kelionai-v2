require('dotenv').config({ path: '.env.local' });
const fetch = require('node-fetch') || globalThis.fetch;

async function test() {
  const url = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return console.log("NO API KEY");

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      messages: [{role: 'user', content: 'Hello'}]
    })
  });
  console.log(resp.status);
  console.log(await resp.text());
}
test();
