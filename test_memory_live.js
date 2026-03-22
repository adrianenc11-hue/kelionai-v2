const axios = require('axios');

async function testMemory() {
  const sessionId = 'test-memory-' + Date.now();
  
  console.log("== TRIMIT MESAJUL 1 ==");
  let res1 = await axios.post('https://kelionai.app/api/admin/brain-chat', {
    message: 'Salut K1! Numele meu secret este XÆA-12. Te rog să ții minte acest nume strict pentru test.',
    sessionId: sessionId
  }, { headers: { 'Authorization': 'Bearer admin_bypass' } }); // Assuming no strict auth or testing only
  
  console.log("Raspuns 1:");
  console.log(res1.data.reply);
  
  console.log("\\n== TRIMIT MESAJUL 2 ==");
  let res2 = await axios.post('https://kelionai.app/api/admin/brain-chat', {
    message: 'Ok, care este numele meu secret pe care tocmai ți l-am zis?',
    sessionId: sessionId
  }, { headers: { 'Authorization': 'Bearer admin_bypass' } });
  
  console.log("Raspuns 2:");
  console.log(res2.data.reply);
}

testMemory().catch(console.error);
