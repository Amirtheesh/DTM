/**
 * Automated Test Suite for Sensor Gateway API
 * Validates requirements:
 * 1. Health endpoint
 * 2. Authorized POST acceptance
 * 3. Unauthorized POST rejection
 * 4. Invalid sensor data rejection (validation errors)
 * 5. Cumulative counting logic & non-negative occupancy
 * 6. Counter reset detection
 * 7. Latest readings & history endpoints
 */

const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { app, server } = require('../server');
const PORT = process.env.PORT || 5000;
const API_KEY = process.env.DEVICE_API_KEY || 'sanitizer_secret_key_2026';

function request(options, bodyData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data, raw: data });
        }
      });
    });

    req.on('error', reject);

    if (bodyData) {
      req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n--- STARTING AUTOMATED API TEST SUITE ---\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. GET /api/health
    const healthRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/health',
      method: 'GET'
    });
    assert(healthRes.status === 200, 'GET /api/health returns 200 OK');
    assert(healthRes.body.status === 'healthy', 'Health status reports "healthy"');

    // 2. Reject POST without X-API-Key
    const unauthRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/sensor-data',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      deviceId: 'test-device',
      entryCount: 1,
      exitCount: 0,
      entryDetected: true,
      exitDetected: false,
      mq135Raw: 400,
      waterLevelRaw: 600,
      relayOn: false
    });
    assert(unauthRes.status === 401, 'POST /api/sensor-data without API key returns 401 Unauthorized');

    // 3. Reject POST with wrong X-API-Key
    const wrongKeyRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/sensor-data',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'invalid_secret_key'
      }
    }, {
      deviceId: 'test-device',
      entryCount: 1,
      exitCount: 0,
      entryDetected: true,
      exitDetected: false,
      mq135Raw: 400,
      waterLevelRaw: 600,
      relayOn: false
    });
    assert(wrongKeyRes.status === 403, 'POST /api/sensor-data with wrong API key returns 403 Forbidden');

    // 4. Reject POST with invalid payload types
    const invalidRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/sensor-data',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      }
    }, {
      deviceId: '', // invalid empty
      entryCount: -5, // invalid negative
      exitCount: 'not-a-number', // invalid string
      entryDetected: 'maybe', // invalid boolean
      exitDetected: false,
      mq135Raw: 99999, // out of range
      waterLevelRaw: -10, // negative
      relayOn: 'off' // invalid boolean
    });
    assert(invalidRes.status === 400, 'POST /api/sensor-data with malformed payload returns 400 Bad Request');
    assert(invalidRes.body.details && invalidRes.body.details.length >= 5, 'Validation returns detailed error list');

    // 5. Accept valid authorized payload matching exact Arduino Uno schema
    const validPayload1 = {
      entryCount: 10,
      exitCount: 3,
      entryDetected: false,
      exitDetected: false,
      mq135Raw: 425,
      mq135High: false,
      waterLevelRaw: 680,
      waterLevelStatus: 'HIGH',
      relayOn: false
    };
    const validRes1 = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/sensor-data',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      }
    }, validPayload1);
    assert(validRes1.status === 201, 'POST /api/sensor-data with valid payload returns 201 Created');
    assert(validRes1.body.data.estimatedOccupancy === 7, 'Estimated occupancy is correctly calculated as 10 - 3 = 7');

    // 6. Test GET /api/sensor-data/latest
    const latestRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/sensor-data/latest',
      method: 'GET'
    });
    assert(latestRes.status === 200, 'GET /api/sensor-data/latest returns 200 OK');
    assert(latestRes.body.reading.deviceId === 'sanitizer-esp32-01', 'Latest reading returns default deviceId');
    assert(latestRes.body.reading.mq135Raw === 425, 'Latest reading returns correct raw ADC values');
    assert(latestRes.body.reading.mq135High === false, 'Latest reading includes mq135High flag');
    assert(latestRes.body.reading.waterLevelStatus === 'HIGH', 'Latest reading includes waterLevelStatus string');
    assert(latestRes.body.deviceStatus.isOnline === true, 'Device status is ONLINE immediately after post');

    // 7. Test people entering advance
    const validPayload2 = {
      deviceId: 'sanitizer-esp32-01',
      entryCount: 12,
      exitCount: 4,
      entryDetected: true,
      exitDetected: false,
      mq135Raw: 430,
      mq135High: true,
      waterLevelRaw: 675,
      waterLevelStatus: 'HIGH',
      waterLevelPercent: null,
      relayOn: true
    };
    await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/sensor-data',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      }
    }, validPayload2);

    // 8. Test GET /api/stats
    const statsRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/stats',
      method: 'GET'
    });
    assert(statsRes.status === 200, 'GET /api/stats returns 200 OK');
    assert(statsRes.body.data.entryCount === 12, 'Stats entryCount reflects latest cumulative reading (12)');
    assert(statsRes.body.data.exitCount === 4, 'Stats exitCount reflects latest cumulative reading (4)');
    assert(statsRes.body.data.estimatedOccupancy === 8, 'Stats estimated occupancy is 12 - 4 = 8');

    // 9. Test Non-negative occupancy edge case (e.g. exitCount > entryCount)
    const anomalyPayload = {
      deviceId: 'sanitizer-esp32-01',
      entryCount: 12,
      exitCount: 15, // more exits than entries
      entryDetected: false,
      exitDetected: false,
      mq135Raw: 410,
      waterLevelRaw: 670,
      waterLevelPercent: null,
      relayOn: false
    };
    await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/sensor-data',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      }
    }, anomalyPayload);

    const statsRes2 = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/stats',
      method: 'GET'
    });
    assert(statsRes2.body.data.estimatedOccupancy === 0, 'Occupancy is clamped to 0 when exits exceed entries (never negative)');

    // 10. Test Reset Detection (e.g. Arduino resets counters to 0, 0)
    const resetPayload = {
      deviceId: 'sanitizer-esp32-01',
      entryCount: 0,
      exitCount: 0,
      entryDetected: false,
      exitDetected: false,
      mq135Raw: 390,
      waterLevelRaw: 650,
      waterLevelPercent: null,
      relayOn: false
    };
    await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/sensor-data',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      }
    }, resetPayload);

    const latestResReset = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/sensor-data/latest',
      method: 'GET'
    });
    assert(latestResReset.body.resetsDetected >= 1, 'Counter drop triggered hardware reset detection');

    // 11. Test History & Events
    const historyRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/sensor-data/history?limit=10',
      method: 'GET'
    });
    assert(historyRes.status === 200, 'GET /api/sensor-data/history returns 200 OK');
    assert(Array.isArray(historyRes.body.data) && historyRes.body.data.length > 0, 'History returns an array of readings');

    const eventsRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/events',
      method: 'GET'
    });
    assert(eventsRes.status === 200, 'GET /api/events returns 200 OK');
    assert(eventsRes.body.data.entryExitEvents.length > 0, 'Event log captured entry/exit/reset events');
    assert(eventsRes.body.data.relayEvents.length > 0, 'Event log captured relay activation state transitions');

    console.log(`\n--- TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ---\n`);

  } catch (err) {
    console.error('Test error:', err);
    failed++;
  } finally {
    server.close();
    process.exit(failed > 0 ? 1 : 0);
  }
}

// Give server time to bind if imported
setTimeout(runTests, 500);
