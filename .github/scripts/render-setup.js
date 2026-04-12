#!/usr/bin/env node
/**
 * render-setup.js
 * Fully configures the Render service:
 *   1. Finds the service by name
 *   2. Sets all environment variables
 *   3. Verifies disk is configured (via render.yaml)
 *   4. Triggers a deploy
 *   5. Waits and reports deploy status
 */

const https = require('https');
const crypto = require('crypto');

const RENDER_API_KEY = process.env.RENDER_API_KEY;
const SERVICE_NAME  = process.env.SERVICE_NAME || 'kelionai-v2';

if (!RENDER_API_KEY) {
  console.error('❌ RENDER_API_KEY is not set');
  process.exit(1);
}

// ── HTTP helper ─────────────────────────────────────────────────────────────
function renderRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.render.com',
      port: 443,
      path: `/v1${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${RENDER_API_KEY}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Generate secure secrets if not provided ─────────────────────────────────
function generateSecret(length = 64) {
  return crypto.randomBytes(length).toString('hex');
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Render Setup Script — kelionai.app');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Step 1: Find service
  console.log('\n[1/5] Finding Render service...');
  const servicesRes = await renderRequest('GET', '/services?limit=50');

  if (servicesRes.status !== 200) {
    console.error('❌ Failed to fetch services:', servicesRes.status, servicesRes.body);
    process.exit(1);
  }

  const services = servicesRes.body;
  const serviceEntry = services.find(s =>
    s.service?.name === SERVICE_NAME ||
    s.service?.slug === SERVICE_NAME
  );

  if (!serviceEntry) {
    console.error(`❌ Service "${SERVICE_NAME}" not found on Render.`);
    console.error('Available services:');
    services.forEach(s => console.error(`  - ${s.service?.name} (${s.service?.id})`));
    process.exit(1);
  }

  const service = serviceEntry.service;
  const serviceId = service.id;
  console.log(`✅ Found: ${service.name} (${serviceId})`);
  console.log(`   URL: ${service.serviceDetails?.url || 'N/A'}`);
  console.log(`   Status: ${service.suspended || 'active'}`);

  // Step 2: Build env vars map
  console.log('\n[2/5] Configuring environment variables...');

  // Generate secrets if not provided via GitHub secrets
  const jwtSecret     = process.env.JWT_SECRET     || generateSecret(32);
  const sessionSecret = process.env.SESSION_SECRET || generateSecret(32);

  const envVars = [
    { key: 'NODE_ENV',              value: 'production' },
    { key: 'PORT',                  value: '8080' },
    { key: 'DB_PATH',               value: '/data/kelion.db' },
    { key: 'APP_BASE_URL',          value: 'https://kelionai.app' },
    { key: 'API_BASE_URL',          value: 'https://kelionai.app' },
    { key: 'CORS_ORIGINS',          value: 'https://kelionai.app' },
    { key: 'COOKIE_DOMAIN',         value: 'kelionai.app' },
    { key: 'GOOGLE_REDIRECT_URI',   value: 'https://kelionai.app/auth/google/callback' },
    { key: 'JWT_SECRET',            value: jwtSecret },
    { key: 'SESSION_SECRET',        value: sessionSecret },
    { key: 'JWT_EXPIRES_IN',        value: '7d' },
    { key: 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD', value: '1' },
    // These come from GitHub secrets — only set if provided
    ...(process.env.OPENAI_API_KEY       ? [{ key: 'OPENAI_API_KEY',       value: process.env.OPENAI_API_KEY }]       : []),
    ...(process.env.STRIPE_SECRET_KEY    ? [{ key: 'STRIPE_SECRET_KEY',    value: process.env.STRIPE_SECRET_KEY }]    : []),
    ...(process.env.STRIPE_WEBHOOK_SECRET? [{ key: 'STRIPE_WEBHOOK_SECRET',value: process.env.STRIPE_WEBHOOK_SECRET }]: []),
    ...(process.env.STRIPE_PUBLISHABLE_KEY?[{ key: 'STRIPE_PUBLISHABLE_KEY',value:process.env.STRIPE_PUBLISHABLE_KEY}]: []),
    ...(process.env.GOOGLE_CLIENT_ID     ? [{ key: 'GOOGLE_CLIENT_ID',     value: process.env.GOOGLE_CLIENT_ID }]     : []),
    ...(process.env.GOOGLE_CLIENT_SECRET ? [{ key: 'GOOGLE_CLIENT_SECRET', value: process.env.GOOGLE_CLIENT_SECRET }] : []),
  ];

  // Render env vars API — PUT replaces ALL env vars
  const envRes = await renderRequest('PUT', `/services/${serviceId}/env-vars`, envVars);

  if (envRes.status === 200 || envRes.status === 201) {
    console.log(`✅ Set ${envVars.length} environment variables`);
    const missing = [];
    if (!process.env.OPENAI_API_KEY)        missing.push('OPENAI_API_KEY');
    if (!process.env.GOOGLE_CLIENT_ID)      missing.push('GOOGLE_CLIENT_ID');
    if (!process.env.GOOGLE_CLIENT_SECRET)  missing.push('GOOGLE_CLIENT_SECRET');
    if (!process.env.STRIPE_SECRET_KEY)     missing.push('STRIPE_SECRET_KEY');
    if (missing.length) {
      console.log(`⚠️  Not set (add to GitHub secrets): ${missing.join(', ')}`);
    }
  } else {
    console.error('❌ Failed to set env vars:', envRes.status, JSON.stringify(envRes.body).slice(0, 300));
    process.exit(1);
  }

  // Step 3: Check disk
  console.log('\n[3/5] Checking persistent disk...');
  const diskRes = await renderRequest('GET', `/services/${serviceId}/disks`);

  if (diskRes.status === 200) {
    const disks = diskRes.body;
    const dataDisk = disks.find(d => d.disk?.mountPath === '/data');
    if (dataDisk) {
      console.log(`✅ Disk already mounted at /data (${dataDisk.disk?.sizeGB}GB)`);
    } else {
      console.log('⚠️  No disk at /data found — creating...');
      const createDisk = await renderRequest('POST', `/services/${serviceId}/disks`, {
        name: 'kelionai-db',
        mountPath: '/data',
        sizeGB: 1,
      });
      if (createDisk.status === 201 || createDisk.status === 200) {
        console.log('✅ Disk created at /data (1GB)');
      } else {
        console.log(`⚠️  Disk create returned ${createDisk.status}: ${JSON.stringify(createDisk.body).slice(0,200)}`);
        console.log('   (Disk may need to be added manually in Render dashboard)');
      }
    }
  } else {
    console.log(`⚠️  Could not check disks (${diskRes.status}) — continuing`);
  }

  // Step 4: Trigger deploy
  console.log('\n[4/5] Triggering deploy...');
  const deployRes = await renderRequest('POST', `/services/${serviceId}/deploys`, {
    clearCache: 'do_not_clear',
  });

  if (deployRes.status !== 201 && deployRes.status !== 200) {
    console.error('❌ Failed to trigger deploy:', deployRes.status, deployRes.body);
    process.exit(1);
  }

  const deployId = deployRes.body.id || deployRes.body.deploy?.id;
  console.log(`✅ Deploy triggered (id: ${deployId})`);

  // Step 5: Wait for deploy to complete (max 10 min)
  console.log('\n[5/5] Waiting for deploy to finish...');
  const startTime = Date.now();
  const maxWait = 10 * 60 * 1000;
  let lastStatus = '';

  while (Date.now() - startTime < maxWait) {
    await sleep(15000);

    const statusRes = await renderRequest('GET', `/services/${serviceId}/deploys/${deployId}`);
    if (statusRes.status !== 200) continue;

    const status = statusRes.body.status || statusRes.body.deploy?.status;
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (status !== lastStatus) {
      console.log(`   [${elapsed}s] Status: ${status}`);
      lastStatus = status;
    }

    if (status === 'live') {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ DEPLOY SUCCESSFUL — https://kelionai.app');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      process.exit(0);
    }

    if (['deactivated', 'build_failed', 'update_failed', 'canceled'].includes(status)) {
      console.error(`\n❌ DEPLOY FAILED — status: ${status}`);

      // Fetch build logs
      const logsRes = await renderRequest('GET', `/services/${serviceId}/deploys/${deployId}/logs`);
      if (logsRes.status === 200 && logsRes.body?.logs) {
        console.error('\nBuild logs (last 50 lines):');
        const lines = logsRes.body.logs.split('\n').slice(-50);
        lines.forEach(l => console.error('  ' + l));
      }
      process.exit(1);
    }
  }

  console.error('❌ Deploy timed out after 10 minutes');
  process.exit(1);
}

main().catch(err => {
  console.error('❌ Unexpected error:', err.message);
  process.exit(1);
});
