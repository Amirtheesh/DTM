/**
 * Automated Sanitizing System - Main Application Orchestrator
 * Coordinates live API polling, UI card updates with strict hierarchy,
 * event log streaming, offline/stale detection, and isolated Demo Mode simulator.
 */

(function() {
  'use strict';

  // Application State
  const state = {
    isDemoMode: false,
    demoInterval: null,
    pollInterval: null,
    lastSeenTimestamp: null,
    lastKnownReadingTimestamp: null,
    staleTimeoutSeconds: 15,
    isBackendConnected: false,
    hasReceivedFirstReading: false,
    
    // In-memory demo state for visual evaluation
    demoData: {
      entryCount: 8,
      exitCount: 3,
      entryDetected: false,
      exitDetected: false,
      mq135Raw: 418,
      mq135High: false,
      waterLevelRaw: 640,
      waterLevelStatus: 'HIGH',
      waterLevelPercent: null, // null by default, status shows HIGH/LOW
      relayOn: false,
      lastEventTime: new Date().toISOString()
    }
  };

  // DOM Elements Cache
  const DOM = {
    // Header & Status
    espStatusPill: document.getElementById('espStatusPill'),
    espStatusText: document.getElementById('espStatusText'),
    apiStatusPill: document.getElementById('apiStatusPill'),
    apiStatusText: document.getElementById('apiStatusText'),
    lastUpdatedText: document.getElementById('lastUpdatedText'),
    demoModeToggle: document.getElementById('demoModeToggle'),
    demoModeBanner: document.getElementById('demoModeBanner'),
    offlineBanner: document.getElementById('offlineBanner'),
    apiErrorBanner: document.getElementById('apiErrorBanner'),
    mobileMenuBtn: document.getElementById('mobileMenuBtn'),
    sidebar: document.getElementById('sidebar'),

    // Cards (Strict Hierarchy Elements)
    // 1. Entering
    cardEnteringValue: document.getElementById('cardEnteringValue'),
    cardEnteringStatus: document.getElementById('cardEnteringStatus'),
    cardEnteringTime: document.getElementById('cardEnteringTime'),

    // 2. Exiting
    cardExitingValue: document.getElementById('cardExitingValue'),
    cardExitingStatus: document.getElementById('cardExitingStatus'),
    cardExitingTime: document.getElementById('cardExitingTime'),

    // 3. Occupancy
    cardOccupancyValue: document.getElementById('cardOccupancyValue'),
    cardOccupancyStatus: document.getElementById('cardOccupancyStatus'),

    // 4. IR Entry D3
    cardIrEntryValue: document.getElementById('cardIrEntryValue'),
    cardIrEntryStatus: document.getElementById('cardIrEntryStatus'),

    // 5. IR Exit D4
    cardIrExitValue: document.getElementById('cardIrExitValue'),
    cardIrExitStatus: document.getElementById('cardIrExitStatus'),

    // 6. Air Quality MQ-135
    cardMq135Value: document.getElementById('cardMq135Value'),
    cardMq135Status: document.getElementById('cardMq135Status'),
    cardMq135ThresholdInfo: document.getElementById('cardMq135ThresholdInfo'),

    // 7. Sanitizer Level
    cardSanitizerValue: document.getElementById('cardSanitizerValue'),
    cardSanitizerStatus: document.getElementById('cardSanitizerStatus'),
    cardSanitizerRaw: document.getElementById('cardSanitizerRaw'),
    cardSanitizerBarFill: document.getElementById('cardSanitizerBarFill'),

    // 8. Relay D6
    cardRelayValue: document.getElementById('cardRelayValue'),
    cardRelayStatus: document.getElementById('cardRelayStatus'),

    // 9. ESP32 Connection
    cardEspValue: document.getElementById('cardEspValue'),
    cardEspStatus: document.getElementById('cardEspStatus'),
    cardEspLastSeen: document.getElementById('cardEspLastSeen'),

    // Event Logs
    entryExitEventsList: document.getElementById('entryExitEventsList'),
    relayEventsList: document.getElementById('relayEventsList')
  };

  /**
   * Initialize Dashboard
   */
  async function init() {
    setupEventListeners();

    // Initialize Charts
    if (window.dashboardCharts) {
      window.dashboardCharts.init();
    }

    // Initial Historical fetch
    await loadInitialHistory();

    // Initial Poll
    await pollLatestData();

    // Start 2-second Polling Loop
    state.pollInterval = setInterval(pollLatestData, 2000);
  }

  function setupEventListeners() {
    // Demo Mode Switch
    DOM.demoModeToggle?.addEventListener('change', (e) => {
      toggleDemoMode(e.target.checked);
    });

    // Mobile Hamburger
    DOM.mobileMenuBtn?.addEventListener('click', () => {
      DOM.sidebar?.classList.toggle('open');
    });

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
      if (DOM.sidebar?.classList.contains('open') && 
          !DOM.sidebar.contains(e.target) && 
          !DOM.mobileMenuBtn?.contains(e.target)) {
        DOM.sidebar.classList.remove('open');
      }
    });

    // Navigation links smooth scroll & active state
    document.querySelectorAll('.nav-item').forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        if (href && href.startsWith('#')) {
          e.preventDefault();
          document.querySelectorAll('.nav-item').forEach(l => l.classList.remove('active'));
          link.classList.add('active');
          const target = document.querySelector(href);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth' });
            if (window.innerWidth <= 768) {
              DOM.sidebar?.classList.remove('open');
            }
          }
        }
      });
    });
  }

  /**
   * Load history points for initial chart render
   */
  async function loadInitialHistory() {
    const res = await window.apiClient.getHistory(30);
    if (res.ok && Array.isArray(res.data.data)) {
      window.dashboardCharts?.updateHistory(res.data.data);
    }
  }

  /**
   * Main 2-second Polling Routine
   */
  async function pollLatestData() {
    if (state.isDemoMode) {
      // Polling is suspended or bypassed when Demo Mode is explicitly active
      return;
    }

    // 1. Fetch Latest Readings
    const latestRes = await window.apiClient.getLatest();
    const nowIso = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    if (!latestRes.ok) {
      setBackendConnectionStatus(false, latestRes.error);
      return;
    }

    setBackendConnectionStatus(true);
    const data = latestRes.data;

    // Check if any reading has ever arrived
    if (!data.reading) {
      renderWaitingForFirstData();
      return;
    }

    state.hasReceivedFirstReading = true;
    const reading = data.reading;
    const deviceStatus = data.deviceStatus || {};

    // Check device freshness / offline
    updateDeviceConnectionStatus(deviceStatus);

    // Update Cards with exact required hierarchy
    renderSensorCards(reading, deviceStatus, data.thresholds);

    // Append to charts if new timestamp
    if (state.lastKnownReadingTimestamp !== reading.receivedAt) {
      state.lastKnownReadingTimestamp = reading.receivedAt;
      window.dashboardCharts?.appendReading(reading);
    }

    // 2. Fetch Events
    const eventsRes = await window.apiClient.getEvents(15);
    if (eventsRes.ok && eventsRes.data.data) {
      renderEvents(eventsRes.data.data);
    }

    DOM.lastUpdatedText.textContent = `Last polled: ${nowIso}`;
  }

  /**
   * Updates Header & Banner Backend Connection status
   */
  function setBackendConnectionStatus(isConnected, errorMsg = '') {
    state.isBackendConnected = isConnected;
    if (isConnected) {
      DOM.apiStatusPill.className = 'status-pill online';
      DOM.apiStatusText.textContent = 'API CONNECTED';
      DOM.apiErrorBanner.style.display = 'none';
    } else {
      DOM.apiStatusPill.className = 'status-pill offline';
      DOM.apiStatusText.textContent = 'API DISCONNECTED';
      DOM.apiErrorBanner.style.display = 'flex';
      const detail = document.getElementById('apiErrorDetail');
      if (detail) detail.textContent = `Backend error: ${errorMsg || 'Server unreachable at port 5000'}`;
    }
  }

  /**
   * Updates ESP32 Online / Offline Status indicators
   */
  function updateDeviceConnectionStatus(deviceStatus) {
    const isOnline = deviceStatus.isOnline;
    const secondsAgo = deviceStatus.secondsAgo ?? null;

    if (isOnline) {
      DOM.espStatusPill.className = 'status-pill online';
      DOM.espStatusText.textContent = 'ESP32 ONLINE';
      DOM.offlineBanner.style.display = 'none';
    } else {
      DOM.espStatusPill.className = 'status-pill offline';
      DOM.espStatusText.textContent = 'ESP32 OFFLINE';
      DOM.offlineBanner.style.display = 'flex';
      const detail = document.getElementById('offlineDetail');
      if (detail) {
        detail.textContent = secondsAgo !== null 
          ? `No data received for ${secondsAgo} seconds (configured timeout: ${state.staleTimeoutSeconds}s). Readings shown below may be stale.`
          : 'Waiting for initial transmission from ESP32 development board.';
      }
    }
  }

  /**
   * Render state when backend is up but no ESP32 reading has arrived yet
   */
  function renderWaitingForFirstData() {
    DOM.espStatusPill.className = 'status-pill offline';
    DOM.espStatusText.textContent = 'ESP32 OFFLINE';
    DOM.offlineBanner.style.display = 'flex';
    const detail = document.getElementById('offlineDetail');
    if (detail) {
      detail.textContent = 'Backend is running. Waiting for initial HTTP POST from ESP32 gateway...';
    }

    // Set placeholder indicators without fake values
    DOM.cardEnteringValue.textContent = '--';
    DOM.cardEnteringStatus.textContent = 'Awaiting Device Connection';
    DOM.cardExitingValue.textContent = '--';
    DOM.cardExitingStatus.textContent = 'Awaiting Device Connection';
    DOM.cardOccupancyValue.textContent = '--';
    DOM.cardOccupancyStatus.textContent = 'Awaiting Counters';

    DOM.cardIrEntryValue.textContent = '--';
    DOM.cardIrEntryStatus.textContent = 'Offline';
    DOM.cardIrExitValue.textContent = '--';
    DOM.cardIrExitStatus.textContent = 'Offline';

    DOM.cardMq135Value.textContent = '--';
    DOM.cardMq135Status.textContent = 'Sensor Standby';

    DOM.cardSanitizerValue.textContent = 'Not Calibrated';
    DOM.cardSanitizerStatus.textContent = 'Awaiting Telemetry';
    DOM.cardSanitizerRaw.textContent = 'Raw ADC: --';
    DOM.cardSanitizerBarFill.style.width = '0%';

    DOM.cardRelayValue.textContent = '--';
    DOM.cardRelayStatus.textContent = 'Command State Unknown';

    DOM.cardEspValue.textContent = 'OFFLINE';
    DOM.cardEspStatus.textContent = 'No Packets Received';
    DOM.cardEspLastSeen.textContent = 'Never';
  }

  /**
   * RENDER SENSOR CARDS
   * Strict Hierarchy:
   * 1. SENSOR NAME (DOM heading)
   * 2. LARGE VALUE DIRECTLY BELOW NAME
   * 3. STATUS DIRECTLY BELOW VALUE
   */
  function renderSensorCards(reading, deviceStatus, thresholds) {
    const isOnline = deviceStatus.isOnline;

    // CARD A: People Entering
    // Cumulative number sent by Arduino
    DOM.cardEnteringValue.textContent = reading.entryCount;
    DOM.cardEnteringStatus.className = 'sensor-status-badge status-active';
    DOM.cardEnteringStatus.textContent = isOnline ? 'Cumulative Entry Count' : 'Last Recorded (Stale)';
    DOM.cardEnteringTime.textContent = reading.lastEventTimestamp 
      ? new Date(reading.lastEventTimestamp).toLocaleTimeString() 
      : 'No events logged';

    // CARD B: People Exiting
    // Cumulative number sent by Arduino
    DOM.cardExitingValue.textContent = reading.exitCount;
    DOM.cardExitingStatus.className = 'sensor-status-badge status-active';
    DOM.cardExitingStatus.textContent = isOnline ? 'Cumulative Exit Count' : 'Last Recorded (Stale)';
    DOM.cardExitingTime.textContent = reading.lastEventTimestamp 
      ? new Date(reading.lastEventTimestamp).toLocaleTimeString() 
      : 'No events logged';

    // CARD C: People Currently Inside
    // Calculated: max(0, entryCount - exitCount)
    const occupancy = Math.max(0, reading.entryCount - reading.exitCount);
    DOM.cardOccupancyValue.textContent = occupancy;
    DOM.cardOccupancyStatus.className = 'sensor-status-badge ' + (occupancy > 0 ? 'status-active' : 'status-clear');
    DOM.cardOccupancyStatus.textContent = occupancy === 1 ? '1 Person Estimated' : `${occupancy} People Estimated`;

    // CARD D: IR Entry Sensor — D3
    if (reading.entryDetected) {
      DOM.cardIrEntryValue.textContent = 'DETECTED';
      DOM.cardIrEntryStatus.className = 'sensor-status-badge status-detected';
      DOM.cardIrEntryStatus.textContent = 'Person In Entry Beam';
    } else {
      DOM.cardIrEntryValue.textContent = 'CLEAR';
      DOM.cardIrEntryStatus.className = 'sensor-status-badge status-clear';
      DOM.cardIrEntryStatus.textContent = 'Beam Unobstructed';
    }

    // CARD E: IR Exit Sensor — D4
    if (reading.exitDetected) {
      DOM.cardIrExitValue.textContent = 'DETECTED';
      DOM.cardIrExitStatus.className = 'sensor-status-badge status-detected';
      DOM.cardIrExitStatus.textContent = 'Person In Exit Beam';
    } else {
      DOM.cardIrExitValue.textContent = 'CLEAR';
      DOM.cardIrExitStatus.className = 'sensor-status-badge status-clear';
      DOM.cardIrExitStatus.textContent = 'Beam Unobstructed';
    }

    // CARD F: Air Quality — MQ-135 (A1)
    // Display actual raw analog reading received from Arduino
    DOM.cardMq135Value.textContent = reading.mq135Raw;

    // Air-quality warning: mq135High
    const isAirAlert = (reading.mq135High === true);
    if (isAirAlert) {
      DOM.cardMq135Status.className = 'sensor-status-badge status-danger';
      DOM.cardMq135Status.textContent = 'Air Alert: Elevated (Warning)';
    } else {
      DOM.cardMq135Status.className = 'sensor-status-badge status-active';
      DOM.cardMq135Status.textContent = 'Air Quality: Normal';
    }
    DOM.cardMq135ThresholdInfo.textContent = `Raw ADC (0-1023) | Alert: ${isAirAlert ? 'ELEVATED' : 'CLEAR'}`;

    // CARD G: Sanitizer Level (A0 Raindrop Sensor)
    DOM.cardSanitizerRaw.textContent = `Raw ADC: ${reading.waterLevelRaw}`;

    if (reading.waterLevelPercent !== null && reading.waterLevelPercent !== undefined) {
      const pct = Math.round(reading.waterLevelPercent);
      DOM.cardSanitizerValue.textContent = `${pct}%`;
      DOM.cardSanitizerBarFill.style.width = `${pct}%`;

      if (pct < 20) {
        DOM.cardSanitizerStatus.className = 'sensor-status-badge status-low';
        DOM.cardSanitizerStatus.textContent = 'Low Sanitizer Warning';
        DOM.cardSanitizerBarFill.className = 'progress-bar-fill low';
      } else {
        DOM.cardSanitizerStatus.className = 'sensor-status-badge status-active';
        DOM.cardSanitizerStatus.textContent = 'Normal Level';
        DOM.cardSanitizerBarFill.className = 'progress-bar-fill';
      }
    } else {
      // Use HIGH/LOW exactly as received for the water-level status
      const statusStr = (reading.waterLevelStatus || (reading.waterLevelRaw > 300 ? 'HIGH' : 'LOW')).toUpperCase();
      DOM.cardSanitizerValue.textContent = statusStr;

      if (statusStr === 'HIGH') {
        DOM.cardSanitizerStatus.className = 'sensor-status-badge status-active';
        DOM.cardSanitizerStatus.textContent = 'Sanitizer Status: High (Normal)';
        DOM.cardSanitizerBarFill.className = 'progress-bar-fill';
        DOM.cardSanitizerBarFill.style.width = '85%';
      } else if (statusStr === 'LOW') {
        DOM.cardSanitizerStatus.className = 'sensor-status-badge status-low';
        DOM.cardSanitizerStatus.textContent = 'Sanitizer Status: Low (Refill)';
        DOM.cardSanitizerBarFill.className = 'progress-bar-fill low';
        DOM.cardSanitizerBarFill.style.width = '20%';
      } else {
        DOM.cardSanitizerStatus.className = 'sensor-status-badge status-uncalibrated';
        DOM.cardSanitizerStatus.textContent = `Status: ${statusStr}`;
        DOM.cardSanitizerBarFill.style.width = '50%';
      }
    }

    // CARD H: Sanitizer Pump / Relay (D6)
    if (reading.relayOn) {
      DOM.cardRelayValue.textContent = 'ON';
      DOM.cardRelayStatus.className = 'sensor-status-badge status-on';
      DOM.cardRelayStatus.textContent = 'Relay Energized (Active-LOW)';
    } else {
      DOM.cardRelayValue.textContent = 'OFF';
      DOM.cardRelayStatus.className = 'sensor-status-badge status-off';
      DOM.cardRelayStatus.textContent = 'Relay De-energized';
    }

    // CARD I: ESP32 Connection
    if (isOnline) {
      DOM.cardEspValue.textContent = 'ONLINE';
      DOM.cardEspStatus.className = 'sensor-status-badge status-online';
      DOM.cardEspStatus.textContent = 'Heartbeat Active';
    } else {
      DOM.cardEspValue.textContent = 'OFFLINE';
      DOM.cardEspStatus.className = 'sensor-status-badge status-offline';
      DOM.cardEspStatus.textContent = 'Data Stream Stale';
    }

    DOM.cardEspLastSeen.textContent = reading.receivedAt 
      ? `${new Date(reading.receivedAt).toLocaleTimeString()} (${deviceStatus.secondsAgo ?? 0}s ago)`
      : 'Never';
  }

  /**
   * Render Event Logs
   */
  function renderEvents(eventsData) {
    // 1. Entry/Exit Events
    const entryList = DOM.entryExitEventsList;
    if (entryList) {
      if (!eventsData.entryExitEvents || eventsData.entryExitEvents.length === 0) {
        entryList.innerHTML = '<div class="empty-state">No entry/exit events recorded yet.</div>';
      } else {
        entryList.innerHTML = eventsData.entryExitEvents.map(ev => {
          let badgeClass = 'event-badge';
          if (ev.type === 'ENTRY') badgeClass += ' entry';
          else if (ev.type === 'EXIT') badgeClass += ' exit';
          else if (ev.type === 'RESET') badgeClass += ' reset';

          const timeStr = new Date(ev.timestamp).toLocaleTimeString();
          return `
            <div class="event-row">
              <span class="${badgeClass}">${ev.type}</span>
              <div class="event-info">
                <span class="event-text">${escapeHtml(ev.message)}</span>
                <span class="event-time">${timeStr} • Total Entries: ${ev.entryCount ?? '--'}, Exits: ${ev.exitCount ?? '--'}</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 2. Relay Events
    const relayList = DOM.relayEventsList;
    if (relayList) {
      if (!eventsData.relayEvents || eventsData.relayEvents.length === 0) {
        relayList.innerHTML = '<div class="empty-state">No pump relay activations recorded yet.</div>';
      } else {
        relayList.innerHTML = eventsData.relayEvents.map(ev => {
          const badgeClass = ev.state === 'ON' ? 'event-badge relay-on' : 'event-badge relay-off';
          const timeStr = new Date(ev.timestamp).toLocaleTimeString();
          return `
            <div class="event-row">
              <span class="${badgeClass}">RELAY ${ev.state}</span>
              <div class="event-info">
                <span class="event-text">${escapeHtml(ev.message)}</span>
                <span class="event-time">${timeStr}</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }

  /**
   * DEMO MODE SIMULATOR
   * Explicitly isolated mode for visual testing without hardware.
   * Generates realistic simulated pulses and clearly marks all data as DEMO DATA.
   */
  function toggleDemoMode(enable) {
    state.isDemoMode = enable;

    if (enable) {
      DOM.demoModeBanner.style.display = 'flex';
      DOM.offlineBanner.style.display = 'none';
      DOM.apiErrorBanner.style.display = 'none';

      // Start periodic demo pulse generator
      runDemoTick();
      state.demoInterval = setInterval(runDemoTick, 2500);
    } else {
      DOM.demoModeBanner.style.display = 'none';
      if (state.demoInterval) {
        clearInterval(state.demoInterval);
        state.demoInterval = null;
      }
      // Revert immediately to polling real backend
      pollLatestData();
    }
  }

  function runDemoTick() {
    const demo = state.demoData;
    const rand = Math.random();

    // Simulate entry event occasionally
    if (rand < 0.4) {
      demo.entryCount += 1;
      demo.entryDetected = true;
      demo.relayOn = true; // pump fires on entry
      setTimeout(() => { demo.entryDetected = false; demo.relayOn = false; }, 800);
    } else if (rand > 0.75) {
      // Simulate exit event
      demo.exitCount += 1;
      demo.exitDetected = true;
      setTimeout(() => { demo.exitDetected = false; }, 800);
    }

    // Gentle random walk for MQ-135 ADC
    demo.mq135Raw = Math.min(650, Math.max(380, demo.mq135Raw + Math.floor((Math.random() - 0.5) * 20)));

    // Water level stays at raw ~630 with null calibration (testing Not Calibrated display)
    demo.waterLevelRaw = Math.min(800, Math.max(500, demo.waterLevelRaw + Math.floor((Math.random() - 0.5) * 8)));

    const nowIso = new Date().toISOString();
    demo.lastEventTime = nowIso;

    const fakeReading = {
      deviceId: 'sanitizer-esp32-DEMO',
      entryCount: demo.entryCount,
      exitCount: demo.exitCount,
      entryDetected: demo.entryDetected,
      exitDetected: demo.exitDetected,
      mq135Raw: demo.mq135Raw,
      mq135High: demo.mq135Raw > 450,
      waterLevelRaw: demo.waterLevelRaw,
      waterLevelStatus: demo.waterLevelRaw > 300 ? 'HIGH' : 'LOW',
      waterLevelPercent: demo.waterLevelPercent,
      relayOn: demo.relayOn,
      receivedAt: nowIso,
      lastEventTimestamp: demo.lastEventTime
    };

    const fakeStatus = {
      isOnline: true,
      status: 'DEMO ONLINE',
      secondsAgo: 0
    };

    // Render cards
    renderSensorCards(fakeReading, fakeStatus, { warningRaw: 450, dangerRaw: 700 });

    // Append to charts
    window.dashboardCharts?.appendReading(fakeReading);

    // Update time
    DOM.lastUpdatedText.textContent = `Demo Tick: ${new Date().toLocaleTimeString()}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Initialize once DOM is fully ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
