// client/src/services/weatherService.js
import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
});

// מוסיף Authorization אוטומטית אם יש טוקן ב-localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const weatherService = {
  /**
   * מחזיר תחזית 3 ימים קדימה לפי קואורדינטות
   * @param {number} lat
   * @param {number} lng
   * @returns {Promise<{ forecast: Array }>}
   */
  async getForecast(lat, lng) {
    const latNum = Number(lat);
    const lngNum = Number(lng);

    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      throw new Error('Invalid coordinates for weather lookup');
    }

    const res = await api.get(`/weather/${latNum}/${lngNum}`);
    // מצופה: { success: true, data: {...} }
    if (res?.data?.success) {
      return res.data.data; // למשל { forecast: [...] }
    }
    throw new Error(res?.data?.message || 'Failed to load weather');
  },
};
