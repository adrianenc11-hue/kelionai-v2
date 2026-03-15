const fetch = require("node-fetch");
process.env.PORT = 3077;
process.env.SENTRY_DSN = ""; // disable sentry to avoid crashes
process.env.ADMIN_SECRET = "test-secret";

// Start server
require("../server/index.js");

setTimeout(async () => {
  const BASE_URL = `http://localhost:${process.env.PORT}`;
  const headers = {
    "Content-Type": "application/json",
    "x-admin-secret": process.env.ADMIN_SECRET,
  };

  async function testEndpoint(name, method, path, body = null) {
    console.log(`\nTesting: ${name} -> ${method} ${path}`);
    try {
      const opts = { method, headers };
      if (body) Object.assign(opts, { body: JSON.stringify(body) });

      const res = await fetch(`${BASE_URL}${path}`, opts);
      const text = await res.text();

      console.log(`Status: ${res.status}`);
      if (res.status !== 404) {
        console.log(`✅ SUCCESS: Endpoint exists! (Status ${res.status})`);
      } else {
        console.log(`❌ FAILED: 404 Not Found.`);
      }
    } catch (err) {
      console.error(`❌ ERROR:`, err.message);
    }
  }

  await testEndpoint("WhatsApp Send", "POST", "/api/whatsapp/send", {
    to: "123",
    text: "hi",
  });
  await testEndpoint("Media Publish", "POST", "/api/media/publish", {
    platform: "all",
    content: "test",
  });
  await testEndpoint("Voice Clone List", "GET", "/api/voice-clone/list");
  await testEndpoint("Service Worker", "GET", "/sw.js");

  console.log("\nTests finished.");
  process.exit(0);
}, 2000);
