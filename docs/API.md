# Automated Sanitizing System — REST API Documentation

This backend service ingests real-time telemetry from an ESP32 gateway and exposes REST API endpoints for the web dashboard.

---

## Base URL

- **Local:** `http://localhost:5000`
- **LAN / Network:** `http://<YOUR_PC_IP>:5000`

---

## Authentication

Device ingestion requires an API key passed in the `X-API-Key` HTTP header. The secret is set in the backend environment via `DEVICE_API_KEY`.

| Header | Value | Description |
|---|---|---|
| `X-API-Key` | `sanitizer_secret_key_2026` | Device authentication secret (never exposed to frontend JavaScript) |

---

## Endpoints

### 1. Ingest Sensor Telemetry

- **Endpoint:** `POST /api/sensor-data`
- **Authentication:** Required (`X-API-Key`)
- **Content-Type:** `application/json`

#### Request Payload (Direct Arduino Schema or ESP32 Ingestion)
```json
{
  "entryCount": 12,
  "exitCount": 4,
  "entryDetected": false,
  "exitDetected": false,
  "mq135Raw": 420,
  "mq135High": false,
  "waterLevelRaw": 630,
  "waterLevelStatus": "HIGH",
  "relayOn": false,
  "deviceId": "sanitizer-esp32-01"
}
```

#### Field Specifications & Validation Rules
| Field | Type | Required | Description & Constraints |
|---|---|---|---|
| `entryCount` | Integer | Yes | Cumulative entries detected by Arduino Uno (must be $\ge 0$) |
| `exitCount` | Integer | Yes | Cumulative exits detected by Arduino Uno (must be $\ge 0$) |
| `entryDetected` | Boolean | Yes | Immediate optical beam state of D3 (`true` if beam obstructed) |
| `exitDetected` | Boolean | Yes | Immediate optical beam state of D4 (`true` if beam obstructed) |
| `mq135Raw` | Number | Yes | 10-bit raw ADC reading from pin A1 ($0 \le \text{val} \le 1023$) |
| `mq135High` | Boolean | Optional | Air-quality threshold alert flag from Arduino (`true` if high) |
| `waterLevelRaw` | Number | Yes | 10-bit raw ADC reading from pin A0 ($0 \le \text{val} \le 1023$) |
| `waterLevelStatus` | String | Optional | Level classification from Arduino (`"HIGH"` or `"LOW"`) |
| `relayOn` | Boolean | Yes | Active-LOW relay state (`true` if pump output is energized) |
| `deviceId` | String | Optional | Device identifier (defaults to `sanitizer-esp32-01` if omitted) |
| `waterLevelPercent` | Number \| null | Optional | Calibrated % ($0 \le \text{val} \le 100$) or `null` if uncalibrated |

#### Successful Response (`201 Created`)
```json
{
  "success": true,
  "message": "Sensor reading accepted successfully.",
  "timestamp": "2026-10-11T17:15:20.123Z",
  "data": {
    "deviceId": "sanitizer-esp32-01",
    "entryCount": 12,
    "exitCount": 4,
    "estimatedOccupancy": 8
  }
}
```

#### Error Responses
- **`400 Bad Request`**: Malformed payload or validation error.
  ```json
  {
    "success": false,
    "error": "Malformed or invalid sensor data payload.",
    "details": ["Field \"entryCount\" must be an integer >= 0."]
  }
  ```
- **`401 Unauthorized`**: Missing `X-API-Key` header.
- **`403 Forbidden`**: Invalid API key.

---

### 2. Retrieve Latest Readings

- **Endpoint:** `GET /api/sensor-data/latest`
- **Authentication:** None (Public)
- **Description:** Returns the most recently accepted reading along with ESP32 connectivity state.

#### Response (`200 OK`)
```json
{
  "success": true,
  "serverTime": "2026-10-11T17:15:22.000Z",
  "deviceStatus": {
    "isOnline": true,
    "status": "ONLINE",
    "reason": "Active heartbeats received",
    "lastSeen": "2026-10-11T17:15:20.123Z",
    "secondsAgo": 2
  },
  "reading": {
    "deviceId": "sanitizer-esp32-01",
    "entryCount": 12,
    "exitCount": 4,
    "estimatedOccupancy": 8,
    "entryDetected": false,
    "exitDetected": false,
    "mq135Raw": 420,
    "waterLevelRaw": 630,
    "waterLevelPercent": null,
    "relayOn": false,
    "receivedAt": "2026-10-11T17:15:20.123Z",
    "lastEventTimestamp": "2026-10-11T17:14:50.000Z"
  },
  "thresholds": {
    "warningRaw": 450,
    "dangerRaw": 700,
    "isCalibrated": false
  },
  "resetsDetected": 0
}
```

---

### 3. Historical Data Series

- **Endpoint:** `GET /api/sensor-data/history?limit=50`
- **Authentication:** None
- **Query Parameters:** `limit` (optional, default: 50, max: 100)
- **Description:** Returns bounded historical time-series for Chart.js graphing.

---

### 4. System Statistics & Occupancy

- **Endpoint:** `GET /api/stats`
- **Authentication:** None
- **Description:** Returns cumulative statistics and estimated occupancy.

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "entryCount": 12,
    "exitCount": 4,
    "estimatedOccupancy": 8,
    "occupancyDisclaimer": "Occupancy is an estimate calculated as max(0, Entries - Exits)...",
    "deviceStatus": {
      "isOnline": true,
      "status": "ONLINE",
      "secondsAgo": 2
    },
    "resetsDetected": 0,
    "hasReceivedData": true
  }
}
```

---

### 5. Server Health Check

- **Endpoint:** `GET /api/health`
- **Authentication:** None

#### Response (`200 OK`)
```json
{
  "success": true,
  "status": "healthy",
  "uptimeSeconds": 1420,
  "serverTimestamp": "2026-10-11T17:15:25.000Z",
  "deviceConnection": {
    "isOnline": true,
    "status": "ONLINE"
  },
  "environment": "development"
}
```

---

### 6. Event Activity Logs

- **Endpoint:** `GET /api/events?limit=20`
- **Authentication:** None
- **Description:** Returns logged entry/exit events and pump relay activation records.

---

## Example cURL Commands for Testing

### Authorized POST Telemetry
```bash
curl -X POST http://localhost:5000/api/sensor-data \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sanitizer_secret_key_2026" \
  -d '{
    "deviceId": "sanitizer-esp32-01",
    "entryCount": 15,
    "exitCount": 5,
    "entryDetected": false,
    "exitDetected": false,
    "mq135Raw": 415,
    "waterLevelRaw": 645,
    "waterLevelPercent": null,
    "relayOn": false
  }'
```

### Fetch Latest Readings
```bash
curl http://localhost:5000/api/sensor-data/latest
```
