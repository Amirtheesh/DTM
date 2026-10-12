# Automated Sanitizing System — IoT Web Dashboard

A complete, full-stack IoT monitoring platform for an **Automated Sanitizing Station**. Built with a high-performance **Node.js & Express** backend and a responsive, modern dark-themed **HTML5 / CSS3 / Vanilla JavaScript** dashboard featuring **Chart.js** historical telemetry graphs.

---

## 1. Project Architecture

```
Physical Station                                                  Dashboard Clients
+-----------------------+           +---------------+           +---------------------------+
|  Arduino Uno R3       |  Serial   |  ESP32 Dev    |  Wi-Fi    |  Node.js / Express Server |
|  - IR Entry: Pin D3   | --------> |  Wi-Fi        | --------> |  - Port: 5000             |
|  - IR Exit:  Pin D4   |  (115200) |  Gateway      | HTTP POST |  - REST API Engine        |
|  - MQ-135:   Pin A1   |           +---------------+           |  - Static Frontend Host   |
|  - Raindrop: Pin A0   |                                       +---------------------------+
|  - 5V Relay: Pin D6   |                                                     |
+-----------------------+                                                     | REST Polling (2s)
                                                                              v
                                                                +---------------------------+
                                                                | Responsive Web Dashboard  |
                                                                | (Navy & Cyan Dark UI)     |
                                                                +---------------------------+
```

---

## 2. Hardware Configuration & Pin Assignments

| Component | Arduino Uno Pin | Signal Type | Role in Automated Sanitizing System |
|---|---|---|---|
| **IR Entry Sensor** | **D3** | Digital (`INPUT_PULLUP`) | Detects entering person; increments cumulative entry counter |
| **IR Exit Sensor** | **D4** | Digital (`INPUT_PULLUP`) | Detects exiting person; increments cumulative exit counter |
| **MQ-135 Gas Sensor** | **A1** | Analog ($0 - 1023$ ADC) | Monitors ambient air quality (raw ADC telemetry) |
| **Raindrop Sensor** | **A0** | Analog ($0 - 1023$ ADC) | Measures sanitizing fluid level via conductance |
| **5V Active-LOW Relay** | **D6** | Digital (`OUTPUT`) | Triggers sanitizer dispenser pump motor (Active-LOW) |
| **ESP32 Gateway** | **Serial (TX/RX)** | UART ($115200\text{ baud}$) | Receives telemetry packets & forwards over Wi-Fi |

> [!NOTE]
> Removed components (16x2 LCD, DHT11 sensor, PIR sensor, buzzer) have been strictly excluded.

---

## 3. Dashboard Features & Design Hierarchy

- **Color Theme**: Navy and charcoal background (`#070d18`, `#0b1325`, `#111e38`) with electric cyan (`#06b6d4`) and vivid blue (`#2563eb`) accents.
- **Card Hierarchy**: Every sensor card strictly adheres to the required vertical hierarchy:
  1. **SENSOR NAME**
  2. **LARGE VALUE DIRECTLY BELOW THE NAME**
  3. **STATUS DIRECTLY BELOW THE VALUE**
- **Non-Negative Occupancy**: Calculated as $\max(0, \text{Entries} - \text{Exits})$, clearly labeled as an estimate with disclaimer notes.
- **True Cumulative Counts**: Driven by Arduino's internal hardware counters—frontend polling will never increment counts artificially.
- **Stale Data / Offline Detection**: Automatically flags ESP32 as `OFFLINE` if readings stop arriving for $> 15$ seconds.
- **Uncalibrated Handling**: Correctly labels raw MQ-135 readings as "Raw ADC" and raindrop readings as "Not Calibrated" without inventing fake ppm or percentage numbers.
- **Isolated Demo Mode**: Built-in toggle switch to preview UI micro-animations and graphs with clearly marked `DEMO DATA` banners.

---

## 4. Quick Start (Windows)

### Prerequisites
- Node.js installed (v18+)

### Step 1: Install Backend Dependencies
```powershell
cd "c:\Users\amirt\OneDrive\Desktop\dtm demo\backend"
npm.cmd install
```

### Step 2: Start the Backend & Dashboard
```powershell
npm.cmd start
```

### Step 3: Open in Browser
Visit:
```
http://localhost:5000
```

---

## 5. Automated Verification Results

The backend includes a comprehensive automated test suite (`backend/test/api.test.js`) which runs 24 verification checks:

```powershell
node test/api.test.js
```

**Verification Results:**
- `GET /api/health` returns `200 OK` (Healthy)
- Unauthenticated requests rejected (`401 Unauthorized`)
- Invalid API keys rejected (`403 Forbidden`)
- Malformed payloads rejected (`400 Bad Request` with field diagnostics)
- Authorized payloads accepted (`201 Created`)
- Estimated occupancy accurately computed
- Non-negative occupancy clamping verified
- Cumulative counting logic verified against polling
- Hardware counter reset detection verified
- Bounded history series and live event stream verified
- **Test Summary: 24 Passed, 0 Failed**

---

## 6. Directory Structure

```
dtm demo/
  backend/
    middleware/
      deviceAuth.js           # X-API-Key authentication middleware
    routes/
      sensorRoutes.js         # REST endpoints (/sensor-data, /latest, /history, /stats, /health)
    services/
      sensorStore.js          # In-memory time-series store & people-counting processor
    test/
      api.test.js             # Automated API test suite
    .env.example              # Environment variables template
    .env                      # Local environment configuration
    package.json              # Backend dependencies (express, cors, dotenv)
    server.js                 # Express server & static frontend host
  frontend/
    css/
      style.css               # Navy/cyan responsive design system & glowing card styles
    js/
      api.js                  # Frontend REST API client
      charts.js               # Chart.js time-series graphing manager
      app.js                  # Main dashboard orchestrator & demo mode simulator
    index.html                # Responsive single-page dashboard with exact card hierarchy
  firmware/
    arduino_sanitizer/
      arduino_sanitizer.ino   # Arduino Uno sketch (sensors, debouncing, relay, serial JSON)
    esp32_gateway/
      esp32_gateway.ino       # ESP32 sketch (Wi-Fi, HTTP POST client with X-API-Key)
  docs/
    API.md                    # REST API specifications and cURL examples
    SETUP.md                  # Windows PC setup, ipconfig, and ESP32 connection guide
    HARDWARE.md               # Hardware pinouts, wiring diagrams, and sensor calibration
  README.md                   # Project documentation
```

---

## 7. Connecting Real Hardware

1. Follow [`docs/SETUP.md`](docs/SETUP.md) to discover your PC's LAN IP address using `ipconfig`.
2. Upload `firmware/arduino_sanitizer/arduino_sanitizer.ino` to the Arduino Uno.
3. Update `WIFI_SSID`, `WIFI_PASSWORD`, and `BACKEND_SERVER_URL` in `firmware/esp32_gateway/esp32_gateway.ino` and upload to the ESP32.
4. Wire Arduino Pin 1 (TX) to ESP32 Pin 16 (RX2) and connect both GND pins.
5. Your dashboard at `http://localhost:5000` will switch to `ESP32 ONLINE` and stream live data.
