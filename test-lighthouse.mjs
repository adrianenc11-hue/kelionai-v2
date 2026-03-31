import { chromium } from 'playwright';
import { execSync } from 'child_process';

const URL = 'https://kelionai.app/chat';

console.log('=== Running Playwright + Google Lighthouse on kelionai.app ===\n');

// Step 1: Playwright visual check
console.log('--- STEP 1: Playwright Visual Check ---');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  console.log('✓ Page loaded successfully');
  console.log('  Title:', await page.title());
  
  // Check avatar canvas
  const canvas = await page.$('canvas');
  if (canvas) {
    const box = await canvas.boundingBox();
    console.log(`✓ 3D Canvas found: ${box.width}x${box.height} at (${box.x}, ${box.y})`);
    if (box.width > 100 && box.height > 100) {
      console.log('✓ Canvas has proper dimensions');
    } else {
      console.log('✗ Canvas too small!');
    }
  } else {
    console.log('✗ No canvas element found - Avatar NOT rendering!');
  }

  // Check key elements
  const elements = {
    'Header': 'header, [class*="header"]',
    'Kelion button': 'button:has-text("Kelion")',
    'Kira button': 'button:has-text("Kira")',
    'CAM button': 'button:has-text("CAM")',
    'MIC button': 'button:has-text("MIC")',
    'SEND button': 'button:has-text("SEND")',
    'Input field': 'input[placeholder*="Type"]',
    'Presentation Monitor': 'text=Presentation Monitor',
  };

  for (const [name, selector] of Object.entries(elements)) {
    const el = await page.$(selector);
    if (el) {
      const visible = await el.isVisible();
      console.log(`${visible ? '✓' : '✗'} ${name}: ${visible ? 'visible' : 'hidden'}`);
    } else {
      console.log(`✗ ${name}: NOT FOUND`);
    }
  }

  // Check for console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await page.waitForTimeout(3000);
  
  // Screenshot
  await page.screenshot({ path: '/home/ubuntu/kelionai-playwright-screenshot.png', fullPage: false });
  console.log('\n✓ Screenshot saved to /home/ubuntu/kelionai-playwright-screenshot.png');

  if (consoleErrors.length > 0) {
    console.log(`\n✗ Console errors (${consoleErrors.length}):`);
    consoleErrors.forEach(e => console.log('  -', e.substring(0, 200)));
  } else {
    console.log('\n✓ No console errors detected');
  }

} catch (err) {
  console.log('✗ Error:', err.message);
} finally {
  await browser.close();
}

// Step 2: Lighthouse
console.log('\n--- STEP 2: Google Lighthouse Audit ---');
try {
  const result = execSync(
    `lighthouse ${URL} --output=json --output-path=/home/ubuntu/lighthouse-report.json --chrome-flags="--headless --no-sandbox" --only-categories=performance,accessibility,best-practices,seo 2>&1`,
    { timeout: 120000, encoding: 'utf-8' }
  );
  
  const fs = await import('fs');
  const report = JSON.parse(fs.readFileSync('/home/ubuntu/lighthouse-report.json', 'utf-8'));
  
  console.log('\n=== LIGHTHOUSE SCORES ===');
  const categories = report.categories;
  for (const [key, cat] of Object.entries(categories)) {
    const score = Math.round(cat.score * 100);
    const emoji = score >= 90 ? '🟢' : score >= 50 ? '🟡' : '🔴';
    console.log(`${emoji} ${cat.title}: ${score}/100`);
  }
  
  // Key metrics
  if (report.audits) {
    console.log('\n=== KEY METRICS ===');
    const metrics = ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index'];
    for (const m of metrics) {
      if (report.audits[m]) {
        console.log(`  ${report.audits[m].title}: ${report.audits[m].displayValue}`);
      }
    }
  }
  
} catch (err) {
  console.log('Lighthouse error:', err.message?.substring(0, 500));
}

console.log('\n=== TEST COMPLETE ===');
