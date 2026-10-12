/*
  =============================================================================
  Project: Automated Sanitizing System — ESP32 Wi-Fi Gateway
  =============================================================================

  Hardware Data Flow:
    Arduino Uno (Sensors) ---> [UART2 9600 Baud] ---> ESP32 Gateway ---> [Wi-Fi HTTP POST] ---> Node.js Backend

  Hardware Connections:
    - ESP32 GPIO 16 (RX2) <--- Arduino Uno D11 (TX) [Via 5V-to-3.3V Level Shifter or Resistor Divider (1k/2k)]
    - ESP32 GPIO 17 (TX2) ---> Arduino Uno D10 (RX)
    - ESP32 GND           <--- Arduino Uno GND   [MANDATORY COMMON GROUND]

  Incoming Arduino Uno Schema (9600 Baud):
    {
      "entryCount": 12,
      "exitCount": 4,
      "entryDetected": false,
      "exitDetected": false,
      "mq135Raw": 420,
      "mq135High": false,
      "waterLevelRaw": 630,
      "waterLevelStatus": "HIGH",
      "relayOn": false
    }
  =============================================================================
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h> // ArduinoJson v6 or v7

// ============================================================================
// NETWORK & BACKEND CONFIGURATION
// ============================================================================
// 1. Wi-Fi Credentials
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// 2. Node.js Backend API Configuration
// IMPORTANT: Replace with your Windows PC's LAN IPv4 address (found via `ipconfig`)
// DO NOT use "localhost" or "127.0.0.1" — the ESP32 is on a separate network interface!
const char* BACKEND_SERVER_URL = "http://192.168.1.50:5000/api/sensor-data";

// 3. Device Authentication Key (Must match DEVICE_API_KEY in backend/.env)
const char* DEVICE_API_KEY     = "sanitizer_secret_key_2026";
const char* DEVICE_ID          = "sanitizer-esp32-01";

// ============================================================================
// HARDWARE UART2 PINS (to Arduino Uno SoftwareSerial D10 RX / D11 TX)
// ============================================================================
#define RXD2 16  // ESP32 GPIO 16: Connects to Arduino Uno Pin 11 (TX)
#define TXD2 17  // ESP32 GPIO 17: Connects to Arduino Uno Pin 10 (RX)
HardwareSerial ArduinoSerial(2);

// Transmission Throttling
unsigned long lastPostTime = 0;
const unsigned long POST_INTERVAL_MS = 1500; // Throttle to 1.5 seconds

void setup() {
  // Debug Serial Monitor
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n==============================================");
  Serial.println("  Automated Sanitizing System — ESP32 Gateway ");
  Serial.println("==============================================");

  // Initialize UART2 for Arduino Uno at 9600 Baud
  ArduinoSerial.begin(9600, SERIAL_8N1, RXD2, TXD2);
  Serial.println("[UART2] Initialized on GPIO16 (RX) / GPIO17 (TX) at 9600 baud.");

  // Connect to Local Wi-Fi Network
  connectWiFi();
}

void connectWiFi() {
  Serial.print("[WiFi] Connecting to SSID: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected successfully!");
    Serial.print("[WiFi] ESP32 Assigned IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("[WiFi] Gateway IP:        ");
    Serial.println(WiFi.gatewayIP());
    Serial.print("[WiFi] Signal Strength:  ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  } else {
    Serial.println("\n[WiFi ERROR] Failed to connect within timeout. Retrying in main loop...");
  }
}

void loop() {
  // Auto-reconnect if Wi-Fi drops
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi WARNING] Connection lost. Reconnecting...");
    connectWiFi();
    delay(1000);
    return;
  }

  // Listen for complete newline-delimited JSON line from Arduino Uno
  if (ArduinoSerial.available()) {
    String incomingPayload = ArduinoSerial.readStringUntil('\n');
    incomingPayload.trim();

    if (incomingPayload.length() > 0) {
      if (incomingPayload.startsWith("{") && incomingPayload.endsWith("}")) {
        Serial.println("[RX Arduino 9600] " + incomingPayload);

        // Forward to backend respecting throttle interval
        unsigned long now = millis();
        if (now - lastPostTime >= POST_INTERVAL_MS) {
          lastPostTime = now;
          sendTelemetryToBackend(incomingPayload);
        }
      } else {
        Serial.println("[RX UART Ignored - Incomplete packet] " + incomingPayload);
      }
    }
  }
}

void sendTelemetryToBackend(String rawArduinoJson) {
  // Parse Arduino JSON message safely
  StaticJsonDocument<512> docIn;
  DeserializationError err = deserializeJson(docIn, rawArduinoJson);

  if (err) {
    Serial.print("[JSON ERROR] Malformed JSON from Arduino: ");
    Serial.println(err.c_str());
    return;
  }

  // Validate presence of critical counters
  if (!docIn.containsKey("entryCount") || !docIn.containsKey("exitCount")) {
    Serial.println("[JSON ERROR] Payload missing entryCount or exitCount fields.");
    return;
  }

  // Construct outgoing payload conforming to backend schema
  StaticJsonDocument<512> docOut;
  docOut["deviceId"]         = DEVICE_ID;
  docOut["entryCount"]       = docIn["entryCount"].as<long>();
  docOut["exitCount"]        = docIn["exitCount"].as<long>();
  docOut["entryDetected"]    = docIn["entryDetected"].as<bool>();
  docOut["exitDetected"]     = docIn["exitDetected"].as<bool>();
  docOut["mq135Raw"]         = docIn["mq135Raw"].as<int>();
  docOut["mq135High"]        = docIn["mq135High"].as<bool>();
  docOut["waterLevelRaw"]    = docIn["waterLevelRaw"].as<int>();
  docOut["waterLevelStatus"] = docIn["waterLevelStatus"].as<const char*>();
  docOut["relayOn"]          = docIn["relayOn"].as<bool>();

  if (docIn.containsKey("waterLevelPercent") && !docIn["waterLevelPercent"].isNull()) {
    docOut["waterLevelPercent"] = docIn["waterLevelPercent"].as<float>();
  } else {
    docOut["waterLevelPercent"] = nullptr;
  }

  String requestBody;
  serializeJson(docOut, requestBody);

  // Send HTTP POST to Node.js backend
  HTTPClient http;
  http.begin(BACKEND_SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", DEVICE_API_KEY);
  http.setTimeout(4000); // 4-second network timeout

  Serial.printf("[HTTP POST] Sending payload to: %s\n", BACKEND_SERVER_URL);
  int httpResponseCode = http.POST(requestBody);

  if (httpResponseCode > 0) {
    String responseString = http.getString();
    Serial.printf("[HTTP %d] Response: %s\n", httpResponseCode, responseString.c_str());
  } else {
    Serial.printf("[HTTP FAILED] Error: %s (Check PC IP address & Windows Firewall)\n", 
                  http.errorToString(httpResponseCode).c_str());
  }

  http.end();
}
