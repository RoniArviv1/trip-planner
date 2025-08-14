// server/routes/weather.js
const express = require('express');
const { getWeatherData } = require('../controllers/weatherController');

const router = express.Router();

/**
 * GET /api/weather/:lat/:lng
 * מחזיר תחזית מזג אוויר עדכנית ל-3 הימים הבאים לפי קואורדינטות התחלה.
 * דוגמה:
 *   GET /api/weather/32.0853/34.7818
 * תגובה:
 *   { success: true, data: { forecast: [ { date, temperature, description, icon, humidity, windSpeed, precipitation }, ... ] } }
 */
router.get('/:lat/:lng', async (req, res, next) => {
  try {
    const lat = Number(req.params.lat);
    const lng = Number(req.params.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates. lat and lng must be numbers',
      });
    }

    const data = await getWeatherData(lat, lng);
    return res.json({ success: true, data });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
