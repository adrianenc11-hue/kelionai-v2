const https = require('https');

const data = JSON.stringify({ message: "Salut, mă auzi?" });

const options = {
  hostname: 'kelionai.app',
  port: 443,
  path: '/api/chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(options, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log("STATUS:", res.statusCode);
    console.log("BODY:", body);
  });
});

req.on('error', console.error);
req.write(data);
req.end();
