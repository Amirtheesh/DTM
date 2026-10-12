# Setup & Deployment Guide — Automated Sanitizing System

This guide walks you through setting up and running the Node.js backend, opening the web dashboard, and connecting your physical Arduino Uno and ESP32 hardware on Windows.

---

## Prerequisites

1. **Node.js**: Version 18+ (verified on Node.js v24+).
2. **Arduino IDE**: Version 2.0+ with ESP32 board definitions installed.
3. **Libraries in Arduino IDE**:
   - `ArduinoJson` (v6.x or v7.x by Benoit Blanchon)
   - Built-in `WiFi` and `HTTPClient` for ESP32.

---

## Step 1: Install Dependencies & Configure Backend

Open PowerShell in the project directory:

```powershell
cd "backend"
npm.cmd install
```

Copy `.env.example` to `.env` (already created for you):
```ini
PORT=5000
NODE_ENV=development
DEVICE_API_KEY=sanitizer_secret_key_2026
DEVICE_TIMEOUT_SECONDS=15
MAX_HISTORY_ITEMS=100
CORS_ORIGIN=*
```

---

## Step 2: Run the Backend Server

Start the server using `npm.cmd start` or `node server.js`:

```powershell
npm.cmd start
```

You will see the startup banner:
```
====================================================
  AUTOMATED SANITIZING SYSTEM — IoT BACKEND GATEWAY
====================================================
  Local URL:        http://localhost:5000
  Network (LAN):    http://0.0.0.0:5000 (Reach via PC IPv4)
  Sensor Ingest:    POST http://<YOUR_PC_IP>:5000/api/sensor-data
  Health Check:     http://localhost:5000/api/health
  Latest Readings:  http://localhost:5000/api/sensor-data/latest
  Device Auth:      X-API-Key: CONFIGURED
====================================================
```

The Express server automatically serves the frontend dashboard from `frontend/index.html` at `http://localhost:5000`.

---

## Step 3: Finding Your PC's LAN IP Address (Crucial for ESP32)

> [!IMPORTANT]
> The ESP32 is a separate physical computer on your Wi-Fi network. It **CANNOT** connect to `http://localhost:5000`, because `localhost` on the ESP32 refers to the ESP32 itself! You must find your Windows PC's IPv4 address.

1. Open PowerShell on Windows.
2. Run:
   ```powershell
   ipconfig
   ```
3. Look for your active adapter (e.g., `Wireless LAN adapter Wi-Fi` or `Ethernet adapter`):
   ```
   IPv4 Address. . . . . . . . . . . : 192.168.1.50
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : 192.168.1.1
   ```
4. Note your IPv4 address (e.g., `192.168.1.50`).

---

## Step 4: Configure & Flash the ESP32

1. Open `firmware/esp32_gateway/esp32_gateway.ino` in Arduino IDE.
2. Update your Wi-Fi credentials:
   ```cpp
   const char* WIFI_SSID     = "Your_WiFi_Name";
   const char* WIFI_PASSWORD = "Your_WiFi_Password";
   ```
3. Update the backend URL with your PC's IP address discovered in Step 3:
   ```cpp
   const char* BACKEND_SERVER_URL = "http://192.168.1.50:5000/api/sensor-data";
   ```
4. Verify the `DEVICE_API_KEY`:
   ```cpp
   const char* DEVICE_API_KEY = "sanitizer_secret_key_2026";
   ```
5. Select board: `ESP32 Dev Module` and the correct COM Port.
6. Click **Upload**.

---

## Step 5: Configure & Flash the Arduino Uno

1. Open `firmware/arduino_sanitizer/arduino_sanitizer.ino` in Arduino IDE.
2. Verify pin assignments match your physical wiring:
   - IR Entry: `Pin D3`
   - IR Exit: `Pin D4`
   - MQ-135: `Pin A1`
   - Raindrop Sensor: `Pin A0`
   - Active-LOW Relay: `Pin D6`
3. Select board: `Arduino Uno` and COM Port.
5. Once uploaded, connect UART wiring between boards (9600 baud):
   - **Arduino Pin D11 (TX)** $\rightarrow$ **ESP32 GPIO 16 (RX2)** (through a 5V-to-3.3V level shifter or 1k/2k resistor divider)
   - **Arduino Pin D10 (RX)** $\leftarrow$ **ESP32 GPIO 17 (TX2)**
   - **Arduino GND** $\rightarrow$ **ESP32 GND** (**MANDATORY Common Ground**)

---

## Step 6: Windows Firewall Allowance

If your ESP32 reports `HTTP error -1` or connection timeout:
1. Windows Firewall may be blocking inbound connections to port 5000.
2. Allow Node.js through Windows Firewall:
   - Windows Defender Firewall -> "Allow an app or feature through Windows Defender Firewall" -> Check `Node.js JavaScript Runtime` for **Private networks**.
   - Or run PowerShell as Administrator:
     ```powershell
     New-NetFirewallRule -DisplayName "Node.js IoT Gateway 5000" -Direction Inbound -LocalPort 5000 -Protocol TCP -Action Allow
     ```

---

## Troubleshooting Guide

### 1. ESP32 Cannot Connect to Wi-Fi
- Ensure your router broadcasts 2.4 GHz (ESP32 does not support 5 GHz Wi-Fi).
- Double-check SSID and password spelling (case sensitive).

### 2. ESP32 Sends Requests but Receives HTTP 401/403
- Ensure the header `X-API-Key` sent in `esp32_gateway.ino` matches `DEVICE_API_KEY` in `backend/.env`.

### 3. ESP32 Receives HTTP 400 Bad Request
- Check Serial Monitor on ESP32 to verify payload format.
- Ensure `entryCount` and `exitCount` are non-negative integers.
- Ensure `mq135Raw` and `waterLevelRaw` are numeric values (0–1023).

### 4. Serial Communication Issues (Arduino Uno to ESP32)
- Ensure **common ground** (`GND` on Uno connected to `GND` on ESP32).
- Ensure baud rate is set to `115200` in both sketches.
- Unplug the Arduino TX/RX wire while uploading code to Arduino Uno, then reconnect it after upload finishes.
