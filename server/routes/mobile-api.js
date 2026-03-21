const express = require('express');
const logger = require('../logger');

const router = express.Router();

// Route: GET /api/mobile/v1/ping
// Description: Simple health check for the mobile app connection
router.get('/ping', (req, res) => {
    logger.info({ component: 'MobileAPI' }, 'Mobile app pinged the master server');
    res.json({
        success: true,
        message: 'KelionAI Mobile Master Server is online and verified.',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
