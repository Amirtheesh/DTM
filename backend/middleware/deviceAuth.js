/**
 * Device Authentication Middleware
 * Validates incoming HTTP requests from the ESP32 using the X-API-Key header.
 * The expected key is configured in the environment variable DEVICE_API_KEY.
 */

function deviceAuth(req, res, next) {
  const expectedKey = process.env.DEVICE_API_KEY;

  if (!expectedKey) {
    console.error('[AUTH ERROR] DEVICE_API_KEY is not defined in server environment variables.');
    return res.status(500).json({
      success: false,
      error: 'Server authentication configuration error. DEVICE_API_KEY is unset.'
    });
  }

  // Header keys in Node/Express are lowercased by default
  const providedKey = req.headers['x-api-key'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');

  if (!providedKey) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Missing device API key in X-API-Key header.'
    });
  }

  if (providedKey !== expectedKey) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Invalid device API key provided.'
    });
  }

  // Authentication succeeded
  next();
}

module.exports = deviceAuth;
