require('dotenv').config({ path: './server/.env' });

async function testOpenRouter(modelName) {
  const url = `https://openrouter.ai/api/v1/chat/completions`;
  console.log(`Testing OpenRouter model: "${modelName}" ...`);
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://kelion.ai',
        'X-Title': 'Kelion Test'
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: 'hello' }]
      })
    });
    
    if (res.ok) {
      console.log(`✅ SUCCESS: ${modelName}`);
      return true;
    } else {
      const errText = await res.text();
      console.log(`❌ FAILED: ${modelName} -> ${res.status} ${errText}`);
      return false;
    }
  } catch (err) {
    console.log(`❌ ERROR testing ${modelName}: ${err.message}`);
    return false;
  }
}

async function runTests() {
  const modelsToTest = [
    'google/gemini-1.5-flash',
    'google/gemini-flash-1.5',
    'google/gemini-1.5-pro',
    'google/gemini-pro-1.5',
    'google/gemma-2-9b-it:free',
    'google/gemma-7b-it:free',
    'openai/gpt-4o-mini',
    'openai/gpt-3.5-turbo'
  ];
  
  let found = false;
  for (const model of modelsToTest) {
    const success = await testOpenRouter(model);
    if (success) {
      console.log(`\n🎉 FOUND WORKING MODEL: ${model}`);
      found = true;
      break;
    }
  }
  
  if (!found) {
    console.log('\n⚠️ NONE OF THE MODELS WORKED! The OpenRouter API key might be invalid or out of credits.');
  }
}

runTests();
