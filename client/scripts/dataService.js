/**
 * civik.link — Data Service
 * Single gateway for all data. Toggle USE_MOCK_DATA in config.js to switch
 * between mock JSON files and the real API. Zero UI changes needed.
 */

import CONFIG from './config.js';

const { USE_MOCK_DATA, MOCK_BASE_PATH, API_BASE_URL } = CONFIG;

// ── Core Fetch Wrapper ─────────────────────────────────────────────────────────

async function fetchData(mockFile, apiEndpoint) {
  const url = USE_MOCK_DATA
    ? `${MOCK_BASE_PATH}/${mockFile}`
    : `${API_BASE_URL}/${apiEndpoint}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return await response.json();
  } catch (err) {
    console.error(`[DataService] Failed to load: ${url}`, err);
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const DataService = {

  async getUserProfile() {
    return fetchData('user-profile.json', 'profile');
  },

  async getHealthData() {
    return fetchData('health.json', 'health-data');
  },

  async getSchemes() {
    const url = `${MOCK_BASE_PATH}/schemes.json?v=${Date.now()}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      return await res.json();
    } catch (e) {
      console.error(`[DataService] Failed: ${url}`, e);
      return null;
    }
  },

  async getNotifications() {
    const url = `${MOCK_BASE_PATH}/notifications.json?v=${Date.now()}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      return await res.json();
    } catch (e) {
      console.error(`[DataService] Failed: ${url}`, e);
      return null;
    }
  },

};

export default DataService;
