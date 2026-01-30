# Weather Images API

A Node.js API that uses **D3.js** to generate weather visualization images from **Open-Meteo Historical Weather** data.

## Features

- **Express** API with two image endpoints: bar chart and **year heatmap**
- **Open-Meteo Historical Weather API** — no API key required for non-commercial use
- **D3.js** + **jsdom** for server-side SVG: daily bar chart (max/min temp, mean humidity) and a **year heatmap** (one row per day Jan–Dec, 24 squares per row with noon centred, colour = temperature)
- **Sharp** to convert SVG to PNG
- Location by **city name** (geocoded via Open-Meteo) or **lat/lon**; optional dates / year

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Optional: environment**

   Copy `.env.example` to `.env` to set `PORT`; no API key is needed for Open-Meteo.

3. **Run the server**

   ```bash
   npm start
   ```

   For development with auto-restart:

   ```bash
   npm run dev
   ```

## API

### `GET /api/weather-image`

Returns a historical weather chart as an image. Data comes from [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api); data has a **~5-day delay**, so only past dates are available.

| Query         | Required | Description                                                                 |
|---------------|----------|-----------------------------------------------------------------------------|
| `city`        | One of   | City name (e.g. `London`, `Berlin`). Resolved via Open-Meteo Geocoding.     |
| `lat`         | One of   | Latitude (use with `lon`).                                                  |
| `lon`         | One of   | Longitude (use with `lat`).                                                 |
| `start_date`  | No       | Start of range (`yyyy-mm-dd`). Default: 7 days ending 6 days ago.           |
| `end_date`    | No       | End of range (`yyyy-mm-dd`). Default: 6 days ago.                           |
| `format`      | No       | `png` (default) or `svg`.                                                   |

**Examples**

- By city (default date range):  
  `GET http://localhost:3000/api/weather-image?city=London`
- By coordinates with custom range:  
  `GET http://localhost:3000/api/weather-image?lat=52.52&lon=13.41&start_date=2025-01-01&end_date=2025-01-07`
- SVG:  
  `GET http://localhost:3000/api/weather-image?city=Berlin&format=svg`

**Response**

- Success: `image/png` or `image/svg+xml` (body is the image)
- Error: JSON with `error` message and status code

### `GET /api/weather-year-image`

Returns a **year heatmap** image: one row per day (January at top → December at bottom), 24 columns (one per hour) with **noon in the centre** of each row. Each cell is coloured by temperature (default blue = cold → red = hot; a custom colour scale can be wired in later).

| Query    | Required | Description                                                                 |
|----------|----------|-----------------------------------------------------------------------------|
| `city`   | One of   | City name.                                                                 |
| `lat`    | One of   | Latitude (use with `lon`).                                                  |
| `lon`    | One of   | Longitude (use with `lat`).                                                 |
| `year`   | No       | Year (e.g. `2024`). Default: previous year (data has ~5-day delay).         |
| `format` | No       | `png` (default) or `svg`.                                                   |

**Examples**

- By city, previous year:  
  `GET http://localhost:3000/api/weather-year-image?city=London`
- By coordinates, specific year:  
  `GET http://localhost:3000/api/weather-year-image?lat=52.52&lon=13.41&year=2024`
- SVG:  
  `GET http://localhost:3000/api/weather-year-image?city=Berlin&year=2024&format=svg`

**Response**

- Success: `image/png` or `image/svg+xml`
- Error: JSON with `error` and status code

### `GET /health`

Returns `{ "ok": true }` for health checks.

## Project structure

```
src/
  index.js           # Express app: /api/weather-image, /api/weather-year-image
  services/
    weather.js       # Open-Meteo Geocoding + Historical Weather (archive) fetch
    chart.js         # D3: daily bar chart + year heatmap (noon-centred hours) → SVG
```

## Data source

- [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) — archive data from 1940 with ~5-day delay
- [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) — resolve city names to coordinates and timezone
