require('dotenv').config({ path: './server/.env' });

async function testModel(modelName) {
  const url = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;
  console.log(`Testing model format: "${modelName}" ...`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GOOGLE_API_KEY}`
    },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: 'user', content: 'hello' }]
    })
  });
  
  if (res.ok) {
    console.log(`✅ SUCCESS: ${modelName}`);
  } else {
    const errText = await res.text();
    console.log(`❌ FAILED: ${modelName} -> ${res.status} ${errText}`);
  }
}

async function runTests() {
  const modelsToTest = [
    'gemini-1.5-flash',
    'models/gemini-1.5-flash',
    'google/gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'models/gemini-1.5-flash-latest',
    'gemini-1.5-flash-8b',
    'gemini-2.5-flash'
  ];
  for (const model of modelsToTest) {
    await testModel(model);
  }
}

runTests();
