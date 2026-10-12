/**
 * Automated Sanitizing System - Frontend API Client
 * Encapsulates REST API calls to the Node.js backend.
 * Provides resilient error handling, timeouts, and clean status reporting.
 */

const API_BASE_URL = (function() {
  // If hosted on file:// or arbitrary port, default to http://localhost:5000
  if (window.location.protocol === 'file:' || !window.location.port) {
    return 'http://localhost:5000/api';
  }
  return '/api';
})();

class SensorApiClient {
  constructor(baseUrl = API_BASE_URL) {
    this.baseUrl = baseUrl;
    this.timeoutMs = 5000;
  }

  /**
   * Internal helper with fetch timeout & structured JSON responses
   */
  async _fetchWithTimeout(endpoint, options = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          ...(options.headers || {})
        }
      });
      clearTimeout(id);

      if (!response.ok) {
        let errorData = {};
        try {
          errorData = await response.json();
        } catch (_) {}
        return {
          ok: false,
          status: response.status,
          error: errorData.error || `HTTP error ${response.status}`,
          data: null
        };
      }

      const json = await response.json();
      return {
        ok: true,
        status: response.status,
        data: json,
        error: null
      };
    } catch (err) {
      clearTimeout(id);
      const isTimeout = err.name === 'AbortError';
      return {
        ok: false,
        status: 0,
        error: isTimeout ? 'Request timed out' : (err.message || 'Network error'),
        data: null
      };
    }
  }

  /**
   * GET /api/sensor-data/latest
   * Returns latest readings & device connectivity status
   */
  async getLatest() {
    return this._fetchWithTimeout('/sensor-data/latest');
  }

  /**
   * GET /api/sensor-data/history?limit=N
   */
  async getHistory(limit = 40) {
    return this._fetchWithTimeout(`/sensor-data/history?limit=${limit}`);
  }

  /**
   * GET /api/stats
   */
  async getStats() {
    return this._fetchWithTimeout('/stats');
  }

  /**
   * GET /api/health
   */
  async getHealth() {
    return this._fetchWithTimeout('/health');
  }

  /**
   * GET /api/events?limit=N
   */
  async getEvents(limit = 20) {
    return this._fetchWithTimeout(`/events?limit=${limit}`);
  }
}

// Export singleton instance
window.apiClient = new SensorApiClient();
