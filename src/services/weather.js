/**
 * Fetches historical weather from Open-Meteo Historical Weather API.
 * No API key required for non-commercial use.
 * @see https://open-meteo.com/en/docs/historical-weather-api
 */

const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";

/**
 * Resolve city name to first result's { latitude, longitude, timezone, name }.
 */
export async function geocodeCity(city) {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set("name", city);
  url.searchParams.set("count", "1");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Geocoding error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const first = json.results?.[0];
  if (!first) throw new Error(`No location found for "${city}"`);
  return {
    latitude: first.latitude,
    longitude: first.longitude,
    timezone: first.timezone || "UTC",
    name: first.name,
  };
}

/**
 * Fetch historical weather for a date range. Data has ~5-day delay; use past dates.
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} startDate - yyyy-mm-dd
 * @param {string} endDate - yyyy-mm-dd
 * @param {string} [timezone] - e.g. "auto" or "Europe/London"
 */
export async function getHistoricalWeather(lat, lon, startDate, endDate, timezone = "auto") {
  const url = new URL(ARCHIVE_URL);
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lon);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("timezone", timezone);
  url.searchParams.set(
    "hourly",
    "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation"
  );

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Historical weather API error ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Get historical weather by city name (geocodes then fetches archive).
 */
export async function getWeatherByCity(city, startDate, endDate) {
  const loc = await geocodeCity(city);
  const data = await getHistoricalWeather(
    loc.latitude,
    loc.longitude,
    startDate,
    endDate,
    loc.timezone
  );
  return { ...data, locationName: loc.name };
}

/**
 * Get historical weather by coordinates.
 */
export async function getWeatherByCoords(lat, lon, startDate, endDate, timezone = "auto") {
  const data = await getHistoricalWeather(lat, lon, startDate, endDate, timezone);
  return data;
}

/**
 * Default date range: 7 days ending 6 days ago (within API's ~5-day delay).
 */
export function getDefaultDateRange() {
  const end = new Date();
  end.setDate(end.getDate() - 6);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return {
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
  };
}
