// ═══════════════════════════════════════════════════════════════
// KelionAI — Product Scanner Routes
// POST /api/scan/product — Barcode lookup via Open Food Facts
// POST /api/scan/barcode-detect — Image → barcode via Gemini Vision
// Saves scan history to Supabase per user
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { getUserFromToken, supabaseAdmin } = require('../supabase');
const logger = require('../logger');

const scanLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: { error: 'Too many scan requests.' },
});

// ── POST /product — Lookup barcode in Open Food Facts ────────
router.post('/product', scanLimiter, async (req, res) => {
  try {
    const { barcode } = req.body;
    if (!barcode || typeof barcode !== 'string' || barcode.length < 6) {
      return res.status(400).json({ error: 'Invalid barcode' });
    }

    // Get user (optional — for saving scan history)
    let user = null;
    try {
      user = await getUserFromToken(req);
    } catch (_e) {
      /* guest scan */
    }

    // Lookup in Open Food Facts (free, no API key needed)
    const cleanBarcode = barcode.replace(/[^0-9]/g, '');
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanBarcode)}.json`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'KelionAI/2.5 (contact@kelionai.app)' },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const data = await response.json();
    if (!data.product || data.status !== 1) {
      return res.status(404).json({ error: 'Product not found in database' });
    }

    const p = data.product;
    const nut = p.nutriments || {};

    const result = {
      barcode: cleanBarcode,
      name: p.product_name || p.product_name_en || 'Unknown Product',
      brand: p.brands || '',
      quantity: p.quantity || '',
      image: p.image_front_small_url || p.image_url || null,
      nutriscore: p.nutriscore_grade || null,
      novaGroup: p.nova_group || null,
      ecoscore: p.ecoscore_grade || null,
      ingredients: p.ingredients_text || p.ingredients_text_en || '',
      allergens: p.allergens || '',
      categories: p.categories || '',
      nutrition: {
        calories: Math.round(nut['energy-kcal_100g'] || nut['energy-kcal'] || 0),
        proteins: parseFloat((nut.proteins_100g || nut.proteins || 0).toFixed(1)),
        carbs: parseFloat((nut.carbohydrates_100g || nut.carbohydrates || 0).toFixed(1)),
        fat: parseFloat((nut.fat_100g || nut.fat || 0).toFixed(1)),
        fiber: parseFloat((nut.fiber_100g || nut.fiber || 0).toFixed(1)),
        sugar: parseFloat((nut.sugars_100g || nut.sugars || 0).toFixed(1)),
        salt: parseFloat((nut.salt_100g || nut.salt || 0).toFixed(1)),
        saturatedFat: parseFloat((nut['saturated-fat_100g'] || 0).toFixed(1)),
      },
      per: '100g',
    };

    // Save to Supabase (per user, async)
    if (supabaseAdmin && user?.id) {
      supabaseAdmin
        .from('brain_memory')
        .insert({
          user_id: user.id,
          memory_type: 'product_scan',
          content: `[SCAN] ${result.name} (${result.barcode}): ${result.nutrition.calories}kcal`,
          context: {
            barcode: result.barcode,
            name: result.name,
            brand: result.brand,
            nutrition: result.nutrition,
            nutriscore: result.nutriscore,
            scannedAt: new Date().toISOString(),
          },
          importance: 3,
        })
        .then(() => logger.info({ component: 'Scanner' }, 'Scan saved to Supabase'))
        .catch(() => {});
    }

    logger.info({ component: 'Scanner', barcode: cleanBarcode, product: result.name }, 'Product scanned');
    res.json(result);
  } catch (e) {
    logger.error({ component: 'Scanner', err: e.message }, 'Scan error');
    res.status(500).json({ error: 'Scan error' });
  }
});

// ── POST /barcode-detect — Image → barcode via Gemini Vision ─
router.post('/barcode-detect', scanLimiter, async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'No image' });

    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'No AI key configured' });

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: "Read any barcode or QR code in this image. Return ONLY the numeric barcode value, nothing else. If no barcode found, return 'NONE'.",
                },
                { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(6000),
      }
    );

    if (!r.ok) return res.status(500).json({ error: 'Vision API error' });
    const d = await r.json();
    const text = (d.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    const barcode = text.replace(/[^0-9]/g, '');

    if (barcode.length >= 8 && text !== 'NONE') {
      res.json({ barcode, method: 'vision' });
    } else {
      res.json({ barcode: null, method: 'vision' });
    }
  } catch (e) {
    res.status(500).json({ error: 'Barcode detection error' });
  }
});

module.exports = router;
