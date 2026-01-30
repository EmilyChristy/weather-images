import "dotenv/config";
import express from "express";
import sharp from "sharp";
import {
  getWeatherByCity,
  getWeatherByCoords,
  getDefaultDateRange,
} from "./services/weather.js";
import { buildWeatherChartSvg } from "./services/chart.js";

const app = express();
const PORT = process.env.PORT || 3000;

// GET /api/weather-image?city=London  -> PNG (default date range: last 7 days, 5-day delay)
// GET /api/weather-image?lat=51.5&lon=-0.1&start_date=2025-01-01&end_date=2025-01-07
// GET /api/weather-image?city=London&format=svg
app.get("/api/weather-image", async (req, res) => {
  try {
    const { city, lat, lon, start_date, end_date, format = "png" } = req.query;

    let data;
    const { start_date: defaultStart, end_date: defaultEnd } = getDefaultDateRange();
    const startDate = start_date || defaultStart;
    const endDate = end_date || defaultEnd;

    if (city) {
      data = await getWeatherByCity(city, startDate, endDate);
    } else if (lat != null && lon != null) {
      data = await getWeatherByCoords(Number(lat), Number(lon), startDate, endDate);
    } else {
      return res.status(400).json({
        error:
          "Provide either 'city' or 'lat' and 'lon'. Optional: start_date, end_date (yyyy-mm-dd). Historical data has ~5-day delay.",
      });
    }

    const svg = buildWeatherChartSvg(data);

    if (format === "svg") {
      res.set("Content-Type", "image/svg+xml");
      return res.send(svg);
    }

    const png = await sharp(Buffer.from(svg))
      .png()
      .toBuffer();

    res.set("Content-Type", "image/png");
    res.send(png);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message || "Failed to generate weather image",
    });
  }
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Weather Images API listening on http://localhost:${PORT}`);
  console.log(
    "Example: GET /api/weather-image?city=London or ?lat=52.52&lon=13.41&start_date=2025-01-01&end_date=2025-01-07"
  );
});
