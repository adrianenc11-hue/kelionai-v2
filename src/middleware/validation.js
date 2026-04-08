'use strict';

/**
 * Middleware that validates the Content-Type header for JSON endpoints.
 */
function requireJson(req, res, next) {
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  next();
}

/**
 * Middleware that checks required fields are present in req.body.
 * @param {string[]} fields - list of required field names
 */
function requireFields(fields) {
  return (req, res, next) => {
    const missing = fields.filter((f) => req.body[f] === undefined || req.body[f] === null);
    if (missing.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        missing,
      });
    }
    next();
  };
}

/**
 * Middleware that guards against payloads exceeding a maximum byte size.
 * @param {number} maxBytes
 */
function limitPayloadSize(maxBytes) {
  return (req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > maxBytes) {
      return res.status(413).json({
        error: `Payload too large. Maximum size is ${maxBytes} bytes.`,
      });
    }
    next();
  };
}

module.exports = { requireJson, requireFields, limitPayloadSize };
