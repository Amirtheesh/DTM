/**
 * In-Memory Sensor Data Store & Event Processor
 * Manages real-time readings from ESP32/Arduino, enforces data types/ranges,
 * tracks cumulative people counters, detects hardware resets, and maintains bounded history.
 */

class SensorStore {
  constructor() {
    this.latestReading = null;
    this.history = [];
    this.entryExitEvents = [];
    this.relayEvents = [];
    this.systemAlerts = [];
    this.maxHistoryItems = parseInt(process.env.MAX_HISTORY_ITEMS, 10) || 100;
    this.deviceTimeoutSeconds = parseInt(process.env.DEVICE_TIMEOUT_SECONDS, 10) || 15;

    // Configurable thresholds for display guidance
    this.airQualityThresholds = {
      warningRaw: 450,
      dangerRaw: 700,
      isCalibrated: false // Uncalibrated until baseline R0 and curve are determined
    };

    // Water level calibration config (can be updated if user provides tank calibration)
    this.waterLevelCalibration = {
      isCalibrated: false,
      emptyRaw: 200,   // Raw ADC when dry
      fullRaw: 850     // Raw ADC when submerged to max line
    };

    // Tracking previous state for change and event detection
    this.previousCounters = {
      entryCount: null,
      exitCount: null,
      relayOn: null,
      lastEventTimestamp: null
    };

    this.resetsDetected = 0;
  }

  /**
   * Validate incoming payload from ESP32
   * Returns { valid: boolean, errors: string[] }
   */
  validatePayload(data) {
    const errors = [];

    if (!data || typeof data !== 'object') {
      return { valid: false, errors: ['Request body must be a valid JSON object.'] };
    }

    // deviceId (optional, defaults to sanitizer-esp32-01)
    if (data.deviceId !== undefined && (typeof data.deviceId !== 'string' || data.deviceId.trim() === '')) {
      errors.push('Field "deviceId", if provided, must be a non-empty string.');
    }

    // entryCount: cumulative integer >= 0
    if (typeof data.entryCount !== 'number' || !Number.isInteger(data.entryCount) || data.entryCount < 0) {
      errors.push('Field "entryCount" must be an integer >= 0.');
    }

    // exitCount: cumulative integer >= 0
    if (typeof data.exitCount !== 'number' || !Number.isInteger(data.exitCount) || data.exitCount < 0) {
      errors.push('Field "exitCount" must be an integer >= 0.');
    }

    // entryDetected: boolean (current beam state on D3)
    if (typeof data.entryDetected !== 'boolean') {
      errors.push('Field "entryDetected" must be a boolean (true/false).');
    }

    // exitDetected: boolean (current beam state on D4)
    if (typeof data.exitDetected !== 'boolean') {
      errors.push('Field "exitDetected" must be a boolean (true/false).');
    }

    // mq135Raw: ADC reading (typically 0-1023 on Arduino Uno 10-bit ADC)
    if (typeof data.mq135Raw !== 'number' || !Number.isFinite(data.mq135Raw) || data.mq135Raw < 0 || data.mq135Raw > 4095) {
      errors.push('Field "mq135Raw" must be a non-negative number within ADC range (0-4095).');
    }

    // mq135High: boolean (air-quality threshold warning flag)
    if (data.mq135High !== undefined && typeof data.mq135High !== 'boolean') {
      errors.push('Field "mq135High" must be a boolean (true/false).');
    }

    // waterLevelRaw: Raindrop sensor ADC reading (0-1023 on Arduino Uno)
    if (typeof data.waterLevelRaw !== 'number' || !Number.isFinite(data.waterLevelRaw) || data.waterLevelRaw < 0 || data.waterLevelRaw > 4095) {
      errors.push('Field "waterLevelRaw" must be a non-negative number within ADC range (0-4095).');
    }

    // waterLevelStatus: string (e.g. "HIGH" / "LOW")
    if (data.waterLevelStatus !== undefined && (typeof data.waterLevelStatus !== 'string' || data.waterLevelStatus.trim() === '')) {
      errors.push('Field "waterLevelStatus" must be a string.');
    }

    // waterLevelPercent: number (0-100) or null (optional)
    if (data.waterLevelPercent !== null && data.waterLevelPercent !== undefined) {
      if (typeof data.waterLevelPercent !== 'number' || data.waterLevelPercent < 0 || data.waterLevelPercent > 100) {
        errors.push('Field "waterLevelPercent" must be null or a number between 0 and 100.');
      }
    }

    // relayOn: boolean (active-LOW relay state reported by Arduino)
    if (typeof data.relayOn !== 'boolean') {
      errors.push('Field "relayOn" must be a boolean (true/false).');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Process and store an accepted reading from ESP32
   */
  addReading(payload) {
    const now = new Date();
    const serverTimestamp = now.toISOString();

    const entryCount = payload.entryCount;
    const exitCount = payload.exitCount;

    // People counting logic & reset detection
    let resetDetected = false;
    if (this.previousCounters.entryCount !== null && this.previousCounters.exitCount !== null) {
      if (entryCount < this.previousCounters.entryCount || exitCount < this.previousCounters.exitCount) {
        // Hardware reset detected!
        resetDetected = true;
        this.resetsDetected++;
        this.addEntryExitEvent({
          type: 'RESET',
          message: `Hardware or counter reset detected (Entries: ${this.previousCounters.entryCount} -> ${entryCount}, Exits: ${this.previousCounters.exitCount} -> ${exitCount})`,
          entryCount,
          exitCount,
          timestamp: serverTimestamp
        });
      }
    }

    // Detect new ENTRY event
    if (this.previousCounters.entryCount !== null && entryCount > this.previousCounters.entryCount && !resetDetected) {
      const delta = entryCount - this.previousCounters.entryCount;
      this.addEntryExitEvent({
        type: 'ENTRY',
        message: `${delta} person(s) entered via IR sensor (D3)`,
        entryCount,
        exitCount,
        delta,
        timestamp: serverTimestamp
      });
      this.previousCounters.lastEventTimestamp = serverTimestamp;
    }

    // Detect new EXIT event
    if (this.previousCounters.exitCount !== null && exitCount > this.previousCounters.exitCount && !resetDetected) {
      const delta = exitCount - this.previousCounters.exitCount;
      this.addEntryExitEvent({
        type: 'EXIT',
        message: `${delta} person(s) exited via IR sensor (D4)`,
        entryCount,
        exitCount,
        delta,
        timestamp: serverTimestamp
      });
      this.previousCounters.lastEventTimestamp = serverTimestamp;
    }

    // Detect RELAY state change
    if (this.previousCounters.relayOn !== null && this.previousCounters.relayOn !== payload.relayOn) {
      this.addRelayEvent({
        state: payload.relayOn ? 'ON' : 'OFF',
        message: payload.relayOn 
          ? 'Sanitizer pump relay energized (D6 Active-LOW triggered)' 
          : 'Sanitizer pump relay de-energized (D6 released)',
        timestamp: serverTimestamp
      });
    }

    // Update previous tracker
    this.previousCounters.entryCount = entryCount;
    this.previousCounters.exitCount = exitCount;
    this.previousCounters.relayOn = payload.relayOn;

    // Calculate estimated occupancy (never allow negative value)
    const estimatedOccupancy = Math.max(0, entryCount - exitCount);

    // Build normalized reading record
    const mq135High = typeof payload.mq135High === 'boolean' 
      ? payload.mq135High 
      : (payload.mq135Raw > (this.airQualityThresholds.warningRaw || 450));

    const waterLevelStatus = typeof payload.waterLevelStatus === 'string'
      ? payload.waterLevelStatus.toUpperCase()
      : (payload.waterLevelRaw > 300 ? 'HIGH' : 'LOW');

    const record = {
      deviceId: payload.deviceId || 'sanitizer-esp32-01',
      entryCount,
      exitCount,
      estimatedOccupancy,
      entryDetected: payload.entryDetected,
      exitDetected: payload.exitDetected,
      mq135Raw: payload.mq135Raw,
      mq135High,
      waterLevelRaw: payload.waterLevelRaw,
      waterLevelStatus,
      waterLevelPercent: payload.waterLevelPercent ?? null,
      relayOn: payload.relayOn,
      receivedAt: serverTimestamp,
      lastEventTimestamp: this.previousCounters.lastEventTimestamp
    };

    this.latestReading = record;

    // Add to bounded historical series
    this.history.push({
      timestamp: serverTimestamp,
      entryCount: record.entryCount,
      exitCount: record.exitCount,
      estimatedOccupancy: record.estimatedOccupancy,
      mq135Raw: record.mq135Raw,
      mq135High: record.mq135High,
      waterLevelRaw: record.waterLevelRaw,
      waterLevelStatus: record.waterLevelStatus,
      waterLevelPercent: record.waterLevelPercent,
      relayOn: record.relayOn
    });

    if (this.history.length > this.maxHistoryItems) {
      this.history.shift();
    }

    return record;
  }

  addEntryExitEvent(event) {
    this.entryExitEvents.unshift({
      id: `ev-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ...event
    });
    if (this.entryExitEvents.length > 100) {
      this.entryExitEvents.pop();
    }
  }

  addRelayEvent(event) {
    this.relayEvents.unshift({
      id: `relay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ...event
    });
    if (this.relayEvents.length > 100) {
      this.relayEvents.pop();
    }
  }

  /**
   * Determine whether ESP32 is currently online based on timeout
   */
  getDeviceStatus() {
    if (!this.latestReading) {
      return {
        isOnline: false,
        status: 'OFFLINE',
        reason: 'No sensor data has been received yet',
        lastSeen: null,
        secondsAgo: null
      };
    }

    const lastSeenTime = new Date(this.latestReading.receivedAt).getTime();
    const elapsedSeconds = Math.floor((Date.now() - lastSeenTime) / 1000);
    const isOnline = elapsedSeconds <= this.deviceTimeoutSeconds;

    return {
      isOnline,
      status: isOnline ? 'ONLINE' : 'OFFLINE',
      reason: isOnline 
        ? 'Active heartbeats received' 
        : `No transmission for ${elapsedSeconds}s (timeout: ${this.deviceTimeoutSeconds}s)`,
      lastSeen: this.latestReading.receivedAt,
      secondsAgo: elapsedSeconds
    };
  }

  getLatest() {
    const status = this.getDeviceStatus();
    return {
      deviceStatus: status,
      reading: this.latestReading,
      thresholds: this.airQualityThresholds,
      resetsDetected: this.resetsDetected
    };
  }

  getHistory(limit = 50) {
    const parsedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), this.maxHistoryItems);
    return this.history.slice(-parsedLimit);
  }

  getStats() {
    const status = this.getDeviceStatus();
    const reading = this.latestReading;

    const entryCount = reading ? reading.entryCount : 0;
    const exitCount = reading ? reading.exitCount : 0;
    const estimatedOccupancy = reading ? reading.estimatedOccupancy : 0;

    return {
      entryCount,
      exitCount,
      estimatedOccupancy,
      occupancyDisclaimer: 'Occupancy is an estimate calculated as max(0, Entries - Exits). Real-world factors such as initial building occupancy prior to power-on, missed detections, or simultaneous passes can introduce variances.',
      deviceStatus: status,
      totalHistoricalPoints: this.history.length,
      resetsDetected: this.resetsDetected,
      hasReceivedData: reading !== null
    };
  }

  getEvents(limit = 20) {
    const parsedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
    return {
      entryExitEvents: this.entryExitEvents.slice(0, parsedLimit),
      relayEvents: this.relayEvents.slice(0, parsedLimit)
    };
  }

  updateAirQualityThresholds(config) {
    if (typeof config.warningRaw === 'number') this.airQualityThresholds.warningRaw = config.warningRaw;
    if (typeof config.dangerRaw === 'number') this.airQualityThresholds.dangerRaw = config.dangerRaw;
    if (typeof config.isCalibrated === 'boolean') this.airQualityThresholds.isCalibrated = config.isCalibrated;
    return this.airQualityThresholds;
  }
}

// Singleton instance across server
module.exports = new SensorStore();
