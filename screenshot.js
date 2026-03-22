require('dotenv').config();
const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.goto('https://kelionai.app/js/fft-lipsync.js');
    await page.evaluate(() => {
        document.body.innerHTML = '<pre style="font-size: 20px; color: white; background: #111; padding: 20px;">' + document.body.innerText.split('MAX_VISEME_AA')[0] + '<span style="color: #0f0; background: #000; font-weight: bold;">MAX_VISEME_AA' + document.body.innerText.split('MAX_VISEME_AA')[1].split('MAX_VISEME')[0] + 'MAX_VISEME' + document.body.innerText.split('MAX_VISEME_AA')[1].split('MAX_VISEME')[1].substring(0, 100) + '</span></pre>';
    });
    await page.screenshot({ path: 'C:\\Users\\adria\\.gemini\\antigravity\\brain\\44033f3c-3b96-45e9-bd95-3deaf3ae8ec5\\dovada_live_lipsync.png' });
    await browser.close();
    console.log('Captura salvata in dovada_live_lipsync.png');
})();
