const express = require('express');
const logger = require('../logger');
const crypto = require('crypto');

const router = express.Router();

// 🔒 Middleware de Securitate — Doar aplicația de mobil oficială are voie aici
router.use((req, res, next) => {
  const secret = req.headers['x-mobile-secret'];
  const expectedSecret = process.env.MOBILE_API_SECRET || 'kelion-mobile-dev-secret';

  if (secret !== expectedSecret) {
    logger.warn({ component: 'MobileAPI', ip: req.ip }, 'Blocked unauthorized mobile request (bad build secret).');
    return res.status(403).json({ success: false, error: 'Unauthorized Build Client' });
  }

  req.mobileSecret = expectedSecret; // Pasează mai departe pentru generare token
  next();
});

// Route: POST /api/mobile/v1/register
// Description: Un "Activation Code" invizibil trimis de telefon la prima deschidere
router.post('/register', async (req, res) => {
  try {
    const { deviceId, platform, appVersion } = req.body;

    if (!deviceId) return res.status(400).json({ success: false, error: 'Missing deviceId' });

    logger.info({ component: 'MobileAPI', deviceId, platform, appVersion }, 'New invisible device activation request.');

    // Generăm un Token de Activare Unic per device bazat pe parola serverului
    const activationToken = crypto.createHmac('sha256', req.mobileSecret).update(deviceId).digest('hex');

    // Salvăm în baza de date (Supabase) ca telefon activ (ready pentru RevenueCat)
    // const { supabaseAdmin } = require('../supabase');
    // await supabaseAdmin.from('mobile_devices').upsert({ device_id: deviceId, platform, token: activationToken, first_seen: new Date() });

    res.json({
      success: true,
      status: 'activated',
      activationToken,
    });
  } catch (err) {
    logger.error({ component: 'MobileAPI', err: err.message }, 'Failed to register device');
    res.status(500).json({ success: false });
  }
});

// Route: POST /api/mobile/v1/heartbeat
// Trâmite starea curentă a aplicației (și GPS nativ) spre "Creier" pentru Admin Panel
router.post('/heartbeat', async (req, res) => {
  try {
    const { deviceId, lat, lng, action, userId } = req.body;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

    // Dacă serverul master rulează trackere live, inserăm device-ul curent pentru a-l vedea pe Hartă!
    if (req.app.locals.liveVisitors && deviceId) {
      req.app.locals.liveVisitors.set(deviceId, {
        isMobileApp: true,
        lat: lat || null,
        lng: lng || null,
        path: `📱 App: ${action || 'Idle'}`,
        ua: 'KelionAI Native App',
        userType: userId ? 'AppUser' : 'AppGuest',
        userName: userId || `Device-${deviceId.substring(0, 5)}`,
        lastSeen: Date.now(),
        ip,
        country: req.headers['cf-ipcountry'] || null,
      });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error({ component: 'MobileHeartbeat', err: err.message }, 'Failed heartbeat');
    res.status(500).json({ success: false });
  }
});

router.get('/ping', (req, res) => {
  logger.info({ component: 'MobileAPI' }, 'Mobile app pinged the master server');
  res.json({
    success: true,
    message: 'KelionAI Mobile Master Server is online and verified.',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
