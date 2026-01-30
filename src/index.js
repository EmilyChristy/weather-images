import "dotenv/config";
import express from "express";
import sharp from "sharp";
import {
  getWeatherByCity,
  getWeatherByCoords,
  getDefaultDateRange,
} from "./services/weather.js";
import { buildWeatherChartSvg, buildYearHeatmapSvg } from "./services/chart.js";

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

// GET /api/weather-year-image?city=London&year=2024&cell_size=12  → year heatmap (1 row/day, 24 cols/hour, noon centred)
app.get("/api/weather-year-image", async (req, res) => {
  try {
    const { city, lat, lon, year, cell_size, cell_border_color, format = "png" } = req.query;

    const y = year ? parseInt(year, 10) : new Date().getFullYear() - 1;
    if (Number.isNaN(y) || y < 1940 || y > new Date().getFullYear()) {
      return res.status(400).json({
        error: `year must be between 1940 and ${new Date().getFullYear()} (use past year for complete data; API has ~5-day delay)`,
      });
    }

    const cellSize = cell_size != null ? parseInt(cell_size, 10) : undefined;
    if (cell_size != null && (Number.isNaN(cellSize) || cellSize < 1 || cellSize > 64)) {
      return res.status(400).json({
        error: "cell_size must be between 1 and 64 (pixels per square)",
      });
    }

    const startDate = `${y}-01-01`;
    const endDate = `${y}-12-31`;

    let data;
    if (city) {
      data = await getWeatherByCity(city, startDate, endDate);
    } else if (lat != null && lon != null) {
      data = await getWeatherByCoords(Number(lat), Number(lon), startDate, endDate);
    } else {
      return res.status(400).json({
        error:
          "Provide either 'city' or 'lat' and 'lon'. Optional: year (default: previous year).",
      });
    }

    const svg = buildYearHeatmapSvg(data, {
      locationName: data.locationName,
      year: y,
      ...(cellSize != null && { cellSize }),
      ...(cell_border_color != null && cell_border_color !== "" && { cellBorderColor: String(cell_border_color) }),
    });

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
      error: err.message || "Failed to generate year heatmap image",
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
  console.log(
    "Year heatmap: GET /api/weather-year-image?city=London&year=2024"
  );
});
