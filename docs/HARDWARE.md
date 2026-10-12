# Hardware Architecture & Wiring Specification

This document details the exact hardware configuration, pin mapping, signal levels, and serial communication specifications for the **Automated Sanitizing System**.

---

## Hardware Component Inventory

| Item # | Component | Model / Type | Interface Pin (Arduino Uno) | Purpose |
|---|---|---|---|---|
| 1 | Microcontroller | Arduino Uno R3 | - | Primary sensor reader & cumulative counter |
| 2 | Wi-Fi Gateway | ESP32 Development Board | Serial RX2 (Pin 16) | Wi-Fi HTTP POST gateway to backend server |
| 3 | IR Entry Sensor | Digital Obstacle Sensor | **Digital Pin D3** | Detects person entering sanitizing station |
| 4 | IR Exit Sensor | Digital Obstacle Sensor | **Digital Pin D4** | Detects person exiting sanitizing station |
| 5 | Air Quality Sensor | MQ-135 Gas Sensor Module | **Analog Pin A1** | Monitors ambient gas / air conductance |
| 6 | Sanitizer Level | Raindrop / Water Sensor | **Analog Pin A0** | Measures sanitizer liquid level via analog probe |
| 7 | Pump Actuator | 5V Active-LOW Relay Module | **Digital Pin D6** | Powers 5V/12V sanitizer dispenser pump |

> [!NOTE]
> **Removed Hardware Notice**: Per system specifications, previously considered parts (LCD 16x2, DHT11 temperature/humidity sensor, PIR motion sensor, buzzer) have been permanently removed. Do not wire them.

---

## Detailed Wiring Diagram & Pinouts

### 1. Arduino Uno to Sensors
- **IR Entry Sensor (D3)**:
  - `VCC` $\rightarrow$ Arduino `5V`
  - `GND` $\rightarrow$ Arduino `GND`
  - `OUT` $\rightarrow$ Arduino `D3` (Configured as `INPUT_PULLUP`)
- **IR Exit Sensor (D4)**:
  - `VCC` $\rightarrow$ Arduino `5V`
  - `GND` $\rightarrow$ Arduino `GND`
  - `OUT` $\rightarrow$ Arduino `D4` (Configured as `INPUT_PULLUP`)
- **MQ-135 Gas Sensor (A1)**:
  - `VCC` $\rightarrow$ Arduino `5V`
  - `GND` $\rightarrow$ Arduino `GND`
  - `AOUT` $\rightarrow$ Arduino `A1` (10-bit ADC, $0 - 1023$)
- **Raindrop Sanitizer Level Sensor (A0)**:
  - `VCC` $\rightarrow$ Arduino `5V`
  - `GND` $\rightarrow$ Arduino `GND`
  - `AOUT` $\rightarrow$ Arduino `A0` (10-bit ADC, $0 - 1023$)
- **5V Active-LOW Relay Module (D6)**:
  - `VCC` $\rightarrow$ Arduino `5V`
  - `GND` $\rightarrow$ Arduino `GND`
  - `IN`  $\rightarrow$ Arduino `D6` (Output: `LOW` = Energized/Pumping, `HIGH` = Idle)

### 2. Arduino Uno to ESP32 Gateway Wiring
- **Arduino Pin D11 (TX)** $\rightarrow$ **ESP32 GPIO 16 (RX2)** (Via 5V-to-3.3V level shifter or 1k$\Omega$/2k$\Omega$ voltage divider)
- **Arduino Pin D10 (RX)** $\leftarrow$ **ESP32 GPIO 17 (TX2)**
- **Arduino GND** $\rightarrow$ **ESP32 GND** (**MANDATORY Common Ground**)

---

## Serial Communication Protocol (Uno $\rightarrow$ ESP32)

- **Baud Rate:** `9600 bps` (8 data bits, no parity, 1 stop bit)
- **Format:** Single-line newline-terminated JSON string
- **Transmission Frequency:** Every $1000\text{ ms}$

### Serial Packet Example
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
  "relayOn": false
}
```

### Explanation of Serial Fields
1. `entryCount`: Cumulative counter maintained continuously by Arduino Uno.
2. `exitCount`: Cumulative counter maintained continuously by Arduino Uno.
3. `entryDetected`: Immediate logical beam state of D3 (`true` when object is in beam).
4. `exitDetected`: Immediate logical beam state of D4 (`true` when object is in beam).
5. `mq135Raw`: Immediate 10-bit ADC integer from pin A1 ($0 - 1023$).
6. `mq135High`: Boolean threshold flag (`true` when ambient gases exceed warning threshold).
7. `waterLevelRaw`: Immediate 10-bit ADC integer from raindrop sensor pin A0 ($0 - 1023$).
8. `waterLevelStatus`: Discrete level string (`"HIGH"` or `"LOW"`).
9. `relayOn`: Boolean command state of pin D6 (`true` when pin is driven `LOW`).

---

## Sensor Behavior & Calibration Details

### 1. MQ-135 Air Quality Sensor (A1)
- The MQ-135 sensor output is read via analog pin A1.
- Arduino Uno has a 10-bit ADC ($2^{10} = 1024$ steps), producing raw values from $0$ to $1023$.
- In the dashboard, this is explicitly presented as **Raw ADC**. It is **not** labeled as PPM or AQI because unheated/uncalibrated tin-dioxide sensors require burn-in time and a known clean-air reference resistance ($R_0$) before true gas concentrations can be calculated.

### 2. Raindrop Sensor Module (A0)
- The raindrop module measures electrical conductance across nickel traces on the sensing board.
- When completely dry in empty tank, conductance is near zero (ADC reads near $0 - 150$).
- When submerged or wet with liquid sanitizer, conductance rises ($500 - 850+$).
- Unless a specific calibration mapping (minimum dry ADC, maximum submerged ADC) is provided, the dashboard displays **Not Calibrated** alongside the raw ADC reading.

### 3. 5V Active-LOW Relay (D6)
- The relay module triggers on a logic `LOW` level.
- On startup, Arduino sets pin D6 to `HIGH` to keep the sanitizer pump inactive.
- When an entering person is detected on D3, Arduino writes `digitalWrite(6, LOW)` for $750\text{ ms}$, then restores it to `HIGH`.
- The dashboard displays the relay command state (`ON` or `OFF`).
