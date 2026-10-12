/*
  =============================================================================
  Project: Automated Sanitizing System — Arduino Uno Sensor Controller
  =============================================================================

  Hardware Connections:
    - IR Sensor 1 (Entry)       : Pin D3
    - IR Sensor 2 (Exit)        : Pin D4
    - MQ-135 Gas Sensor         : Pin A1 (Analog 10-bit Raw ADC)
    - Raindrop Sensor (Level)   : Pin A0 (Analog 10-bit Raw ADC)
    - 5V Active-LOW Relay (Pump): Pin D6 (LOW = Energized, HIGH = De-energized)
    - SoftwareSerial to ESP32   : Pin D10 (RX) <--- ESP32 GPIO 17 (TX2)
                                  Pin D11 (TX) ---> ESP32 GPIO 16 (RX2) [via 5V-to-3.3V shifter]
                                  Baud Rate: 9600
    - Common Ground             : Arduino GND linked to ESP32 GND

  Payload Format (9600 baud, newline-delimited JSON):
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

#include <SoftwareSerial.h>

// Pin Definitions
const int PIN_IR_ENTRY   = 3;  // IR Entry Sensor
const int PIN_IR_EXIT    = 4;  // IR Exit Sensor
const int PIN_RELAY_PUMP = 6;  // 5V Active-LOW Relay
const int PIN_MQ135      = A1; // MQ-135 Air Quality Analog Pin
const int PIN_WATER      = A0; // Raindrop Sensor Analog Pin

// SoftwareSerial interface to ESP32 (Pin 10 RX, Pin 11 TX)
SoftwareSerial espSerial(10, 11);

// Cumulative Event Counters
unsigned long entryCount = 0;
unsigned long exitCount  = 0;

// Debouncing and State Tracking
int lastEntryState = HIGH;
int lastExitState  = HIGH;
unsigned long lastEntryDebounceTime = 0;
unsigned long lastExitDebounceTime  = 0;
const unsigned long DEBOUNCE_DELAY  = 120; // milliseconds

// Relay Auto-Dispense Timing
bool relayIsActive = false;
unsigned long relayStartTime = 0;
const unsigned long DISPENSE_DURATION_MS = 750; // Active pump pulse duration

// Serial Telemetry Broadcast Timer
unsigned long lastTelemetryTime = 0;
const unsigned long TELEMETRY_INTERVAL_MS = 1000;

// Thresholds for flags
const int MQ135_THRESHOLD_WARNING = 450;
const int WATER_LEVEL_THRESHOLD   = 300;

void setup() {
  // Debug monitor on USB Serial
  Serial.begin(9600);

  // Communications link to ESP32
  espSerial.begin(9600);

  // Configure Sensor & Actuator Pins
  pinMode(PIN_IR_ENTRY, INPUT_PULLUP);
  pinMode(PIN_IR_EXIT, INPUT_PULLUP);

  // Active-LOW Relay: initialize HIGH so pump starts OFF
  pinMode(PIN_RELAY_PUMP, OUTPUT);
  digitalWrite(PIN_RELAY_PUMP, HIGH); // OFF state
  relayIsActive = false;

  delay(500);
  Serial.println(F("[Arduino] Sanitizer Controller Initialized at 9600 baud."));
}

void loop() {
  unsigned long currentMillis = millis();

  // -------------------------------------------------------------
  // 1. READ IR ENTRY SENSOR (D3)
  // -------------------------------------------------------------
  int rawEntryReading = digitalRead(PIN_IR_ENTRY);
  bool entryDetected = (rawEntryReading == LOW);

  if (entryDetected && (lastEntryState == HIGH) && (currentMillis - lastEntryDebounceTime > DEBOUNCE_DELAY)) {
    entryCount++;
    lastEntryDebounceTime = currentMillis;

    // Trigger Sanitizer Dispenser Pump (Active-LOW: write LOW to turn ON)
    digitalWrite(PIN_RELAY_PUMP, LOW);
    relayIsActive = true;
    relayStartTime = currentMillis;
  }
  lastEntryState = rawEntryReading;

  // -------------------------------------------------------------
  // 2. READ IR EXIT SENSOR (D4)
  // -------------------------------------------------------------
  int rawExitReading = digitalRead(PIN_IR_EXIT);
  bool exitDetected = (rawExitReading == LOW);

  if (exitDetected && (lastExitState == HIGH) && (currentMillis - lastExitDebounceTime > DEBOUNCE_DELAY)) {
    exitCount++;
    lastExitDebounceTime = currentMillis;
  }
  lastExitState = rawExitReading;

  // -------------------------------------------------------------
  // 3. MANAGE DISPENSER RELAY PULSE TIMER
  // -------------------------------------------------------------
  if (relayIsActive && (currentMillis - relayStartTime >= DISPENSE_DURATION_MS)) {
    digitalWrite(PIN_RELAY_PUMP, HIGH); // De-energize relay (OFF)
    relayIsActive = false;
  }

  // -------------------------------------------------------------
  // 4. PERIODIC TELEMETRY BROADCAST TO ESP32 (EVERY 1000ms)
  // -------------------------------------------------------------
  if (currentMillis - lastTelemetryTime >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryTime = currentMillis;

    // Sample analog sensors (10-bit ADC: 0 to 1023)
    int mq135Raw = analogRead(PIN_MQ135);
    int waterLevelRaw = analogRead(PIN_WATER);

    // Compute status flags
    bool mq135High = (mq135Raw > MQ135_THRESHOLD_WARNING);
    const char* waterLevelStatus = (waterLevelRaw > WATER_LEVEL_THRESHOLD) ? "HIGH" : "LOW";
    bool relayCommandOn = (digitalRead(PIN_RELAY_PUMP) == LOW);

    // Build newline-delimited JSON string
    String json = "{";
    json += "\"entryCount\":" + String(entryCount) + ",";
    json += "\"exitCount\":" + String(exitCount) + ",";
    json += "\"entryDetected\":" + String(entryDetected ? "true" : "false") + ",";
    json += "\"exitDetected\":" + String(exitDetected ? "true" : "false") + ",";
    json += "\"mq135Raw\":" + String(mq135Raw) + ",";
    json += "\"mq135High\":" + String(mq135High ? "true" : "false") + ",";
    json += "\"waterLevelRaw\":" + String(waterLevelRaw) + ",";
    json += "\"waterLevelStatus\":\"" + String(waterLevelStatus) + "\",";
    json += "\"relayOn\":" + String(relayCommandOn ? "true" : "false");
    json += "}";

    // Transmit to ESP32 via SoftwareSerial (D11 TX)
    espSerial.println(json);

    // Also mirror to USB Serial monitor for easy debugging
    Serial.println(json);
  }
}
