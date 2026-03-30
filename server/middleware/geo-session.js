// server/middleware/geo-session.js
// Middleware that extracts geo coordinates from request body (if present) and stores them in the session.
// This allows downstream routes (e.g., weather) to fallback to the last known location.

module.exports = function (req, res, next) {
  // Ensure session object exists
  if (!req.session) req.session = {};

  // If request includes geo payload (lat/lng), store it in session
  if (req.body && typeof req.body.lat === 'number' && typeof req.body.lng === 'number') {
    req.session.geo = { lat: req.body.lat, lng: req.body.lng };
  }

  // Also expose a helper to retrieve current geo
  req.getGeo = function () {
    if (req.body && typeof req.body.lat === 'number' && typeof req.body.lng === 'number') {
      return { lat: req.body.lat, lng: req.body.lng };
    }
    if (req.session && req.session.geo) return req.session.geo;
    return null;
  };

  next();
};
