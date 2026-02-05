import "dotenv/config";
import express from "express";
import sharp from "sharp";
import {
  getWeatherByCity,
  getWeatherByCoords,
  getDefaultDateRange,
} from "./services/weather.js";
import { buildWeatherChartSvg, buildYearHeatmapSvg, buildRainfallChartSvg, buildRainfallYearHeatmapSvg } from "./services/chart.js";
import { generateCacheKey, getCache } from "./services/cache.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize cache at startup to avoid async overhead on first request
let cacheReady = false;
getCache().then(() => {
  cacheReady = true;
  console.log("Cache initialized and ready");
}).catch(err => {
  console.error(`Cache initialization error: ${err.message}`);
});

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

    // Generate cache key from all parameters
    const cacheKey = generateCacheKey({
      endpoint: "weather-image",
      city: city || null,
      lat: lat ? Number(lat).toFixed(4) : null,
      lon: lon ? Number(lon).toFixed(4) : null,
      start_date: startDate,
      end_date: endDate,
      format,
    });

    // Check cache
    const cache = await getCache();
    const cached = await cache.get(cacheKey, format);
    if (cached) {
      res.set("Content-Type", format === "svg" ? "image/svg+xml" : "image/png");
      return res.send(cached);
    }

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
      // Cache in background, don't wait
      cache.set(cacheKey, format, Buffer.from(svg)).catch(err => 
        console.error(`Background cache set error: ${err.message}`)
      );
      return res.send(svg);
    }

    // Optimize Sharp PNG conversion for speed (lower compression = faster)
    const png = await sharp(Buffer.from(svg))
      .png({ 
        compressionLevel: 1, // Faster compression (1-9, lower is faster)
        quality: 90, // Good quality but faster
        effort: 1 // Lower effort = faster encoding
      })
      .toBuffer();

    res.set("Content-Type", "image/png");
    // Send response immediately, cache in background
    res.send(png);
    cache.set(cacheKey, format, png).catch(err => 
      console.error(`Background cache set error: ${err.message}`)
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message || "Failed to generate weather image",
    });
  }
});

// GET /api/rainfall-image?city=London  -> PNG showing daily rainfall (default date range: last 7 days, 5-day delay)
// GET /api/rainfall-image?lat=51.5&lon=-0.1&start_date=2025-01-01&end_date=2025-01-07
// GET /api/rainfall-image?city=London&format=svg
app.get("/api/rainfall-image", async (req, res) => {
  try {
    const { city, lat, lon, start_date, end_date, format = "png" } = req.query;

    let data;
    const { start_date: defaultStart, end_date: defaultEnd } = getDefaultDateRange();
    const startDate = start_date || defaultStart;
    const endDate = end_date || defaultEnd;

    // Generate cache key from all parameters
    const cacheKey = generateCacheKey({
      endpoint: "rainfall-image",
      city: city || null,
      lat: lat ? Number(lat).toFixed(4) : null,
      lon: lon ? Number(lon).toFixed(4) : null,
      start_date: startDate,
      end_date: endDate,
      format,
    });

    // Check cache
    const cache = await getCache();
    const cached = await cache.get(cacheKey, format);
    if (cached) {
      res.set("Content-Type", format === "svg" ? "image/svg+xml" : "image/png");
      return res.send(cached);
    }

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

    const svg = buildRainfallChartSvg(data);

    if (format === "svg") {
      res.set("Content-Type", "image/svg+xml");
      // Cache in background, don't wait
      cache.set(cacheKey, format, Buffer.from(svg)).catch(err => 
        console.error(`Background cache set error: ${err.message}`)
      );
      return res.send(svg);
    }

    // Optimize Sharp PNG conversion for speed (lower compression = faster)
    const png = await sharp(Buffer.from(svg))
      .png({ 
        compressionLevel: 1, // Faster compression (1-9, lower is faster)
        quality: 90, // Good quality but faster
        effort: 1 // Lower effort = faster encoding
      })
      .toBuffer();

    res.set("Content-Type", "image/png");
    // Send response immediately, cache in background
    res.send(png);
    cache.set(cacheKey, format, png).catch(err => 
      console.error(`Background cache set error: ${err.message}`)
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message || "Failed to generate rainfall image",
    });
  }
});

// GET /api/rainfall-year-image?city=London&year=2024  → year heatmap (same format as temperature: 1 row/day, 24 cols/hour, noon centred), fixed 0–20 mm scale for comparison
app.get("/api/rainfall-year-image", async (req, res) => {
  try {
    const { city, lat, lon, year, cell_size, cell_border_color, show_labels, format = "png" } = req.query;

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

    const showTooltips = show_labels == null
      ? true
      : ["true", "1", "yes"].includes(String(show_labels).toLowerCase());

    const cacheKey = generateCacheKey({
      endpoint: "rainfall-year-image",
      city: city || null,
      lat: lat ? Number(lat).toFixed(4) : null,
      lon: lon ? Number(lon).toFixed(4) : null,
      year: y,
      cell_size: cellSize || 8,
      cell_border_color: cell_border_color || "#aaaaaa",
      show_labels: showTooltips,
      format,
    });

    const cache = await getCache();
    const cached = await cache.get(cacheKey, format);
    if (cached) {
      res.set("Content-Type", format === "svg" ? "image/svg+xml" : "image/png");
      return res.send(cached);
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

    const svg = buildRainfallYearHeatmapSvg(data, {
      locationName: data.locationName,
      year: y,
      ...(cellSize != null && { cellSize }),
      ...(cell_border_color != null && cell_border_color !== "" && { cellBorderColor: String(cell_border_color) }),
      showTooltips,
    });

    if (format === "svg") {
      res.set("Content-Type", "image/svg+xml");
      cache.set(cacheKey, format, Buffer.from(svg)).catch(err =>
        console.error(`Background cache set error: ${err.message}`)
      );
      return res.send(svg);
    }

    const png = await sharp(Buffer.from(svg))
      .png({
        compressionLevel: 1,
        quality: 90,
        effort: 1,
      })
      .toBuffer();

    res.set("Content-Type", "image/png");
    res.send(png);
    cache.set(cacheKey, format, png).catch(err =>
      console.error(`Background cache set error: ${err.message}`)
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message || "Failed to generate rainfall year heatmap image",
    });
  }
});

// GET /api/weather-year-image?city=London&year=2024&cell_size=12  → year heatmap (1 row/day, 24 cols/hour, noon centred)
app.get("/api/weather-year-image", async (req, res) => {
  try {
    const { city, lat, lon, year, cell_size, cell_border_color, show_labels, format = "png" } = req.query;

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

    // Parse show_labels: "true", "1", "yes" = true; "false", "0", "no" = false; default true
    const showTooltips = show_labels == null 
      ? true 
      : ["true", "1", "yes"].includes(String(show_labels).toLowerCase());

    // Generate cache key from all parameters
    const cacheKey = generateCacheKey({
      endpoint: "weather-year-image",
      city: city || null,
      lat: lat ? Number(lat).toFixed(4) : null,
      lon: lon ? Number(lon).toFixed(4) : null,
      year: y,
      cell_size: cellSize || 8,
      cell_border_color: cell_border_color || "#aaaaaa",
      show_labels: showTooltips,
      format,
    });

    // Check cache
    const cache = await getCache();
    const cached = await cache.get(cacheKey, format);
    if (cached) {
      res.set("Content-Type", format === "svg" ? "image/svg+xml" : "image/png");
      return res.send(cached);
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
      showTooltips,
    });

    if (format === "svg") {
      res.set("Content-Type", "image/svg+xml");
      // Cache in background, don't wait
      cache.set(cacheKey, format, Buffer.from(svg)).catch(err => 
        console.error(`Background cache set error: ${err.message}`)
      );
      return res.send(svg);
    }

    // Optimize Sharp PNG conversion for speed (lower compression = faster)
    const png = await sharp(Buffer.from(svg))
      .png({ 
        compressionLevel: 1, // Faster compression (1-9, lower is faster)
        quality: 90, // Good quality but faster
        effort: 1 // Lower effort = faster encoding
      })
      .toBuffer();

    res.set("Content-Type", "image/png");
    // Send response immediately, cache in background
    res.send(png);
    cache.set(cacheKey, format, png).catch(err => 
      console.error(`Background cache set error: ${err.message}`)
    );
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
    "Rainfall chart: GET /api/rainfall-image?city=London&start_date=2025-01-01&end_date=2025-01-07"
  );
  console.log(
    "Rainfall year heatmap (fixed 0–20 mm scale): GET /api/rainfall-year-image?city=London&year=2024"
  );
  console.log(
    "Year heatmap: GET /api/weather-year-image?city=London&year=2024"
  );
});
