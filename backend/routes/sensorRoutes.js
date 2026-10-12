const express = require('express');
const router = express.Router();
const sensorStore = require('../services/sensorStore');
const deviceAuth = require('../middleware/deviceAuth');

/**
 * POST /api/sensor-data
 * Ingests sensor readings from ESP32.
 * Protected by X-API-Key device authentication header.
 */
router.post('/sensor-data', deviceAuth, (req, res) => {
  const payload = req.body;

  // Validate incoming payload
  const validation = sensorStore.validatePayload(payload);
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: 'Malformed or invalid sensor data payload.',
      details: validation.errors
    });
  }

  // Record reading
  try {
    const acceptedRecord = sensorStore.addReading(payload);
    return res.status(201).json({
      success: true,
      message: 'Sensor reading accepted successfully.',
      timestamp: acceptedRecord.receivedAt,
      data: {
        deviceId: acceptedRecord.deviceId,
        entryCount: acceptedRecord.entryCount,
        exitCount: acceptedRecord.exitCount,
        estimatedOccupancy: acceptedRecord.estimatedOccupancy
      }
    });
  } catch (err) {
    console.error('[INGEST ERROR]', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error processing sensor data.'
    });
  }
});

/**
 * GET /api/sensor-data/latest
 * Returns latest accepted sensor readings and device connectivity.
 */
router.get('/sensor-data/latest', (req, res) => {
  const latestData = sensorStore.getLatest();
  return res.json({
    success: true,
    serverTime: new Date().toISOString(),
    ...latestData
  });
});

/**
 * GET /api/sensor-data/history
 * Returns historical series for Chart.js graphs.
 * Query: ?limit=50
 */
router.get('/sensor-data/history', (req, res) => {
  const limit = req.query.limit || 50;
  const history = sensorStore.getHistory(limit);
  return res.json({
    success: true,
    count: history.length,
    data: history
  });
});

/**
 * GET /api/stats
 * Returns cumulative statistics and estimated occupancy.
 */
router.get('/stats', (req, res) => {
  const stats = sensorStore.getStats();
  return res.json({
    success: true,
    data: stats
  });
});

/**
 * GET /api/health
 * Returns server health, uptime, and device status.
 */
router.get('/health', (req, res) => {
  const deviceStatus = sensorStore.getDeviceStatus();
  return res.json({
    success: true,
    status: 'healthy',
    uptimeSeconds: Math.floor(process.uptime()),
    serverTimestamp: new Date().toISOString(),
    deviceConnection: deviceStatus,
    environment: process.env.NODE_ENV || 'development'
  });
});

/**
 * GET /api/events
 * Returns recent entry/exit events and relay activation events.
 */
router.get('/events', (req, res) => {
  const limit = req.query.limit || 20;
  const events = sensorStore.getEvents(limit);
  return res.json({
    success: true,
    data: events
  });
});

/**
 * POST /api/config/thresholds
 * Updates configurable air quality thresholds
 */
router.post('/config/thresholds', (req, res) => {
  const { warningRaw, dangerRaw, isCalibrated } = req.body;
  const updated = sensorStore.updateAirQualityThresholds({ warningRaw, dangerRaw, isCalibrated });
  return res.json({
    success: true,
    message: 'Air quality thresholds updated.',
    thresholds: updated
  });
});

module.exports = router;
