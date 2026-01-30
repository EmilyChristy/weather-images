import { JSDOM } from "jsdom";
import * as d3 from "d3";

const WIDTH = 700;
const HEIGHT = 420;
const MARGIN = { top: 50, right: 50, bottom: 60, left: 55 };

/**
 * Aggregate Open-Meteo hourly data into one row per day.
 * @param {Object} data - Open-Meteo archive response: { hourly: { time, temperature_2m, relative_humidity_2m, apparent_temperature, precipitation } }
 * @returns {Array<{ date, maxTemp, minTemp, meanHumidity, meanApparentTemp, precipitationSum }>}
 */
function aggregateHourlyToDaily(data) {
  const hourly = data.hourly;
  if (!hourly?.time?.length) return [];

  const time = hourly.time;
  const temp = hourly.temperature_2m ?? [];
  const humidity = hourly.relative_humidity_2m ?? [];
  const apparent = hourly.apparent_temperature ?? [];
  const precip = hourly.precipitation ?? [];

  const byDay = new Map(); // date string -> { maxTemp, minTemp, sumHumidity, count, sumApparent, sumPrecip }

  for (let i = 0; i < time.length; i++) {
    const dateStr = time[i].slice(0, 10); // yyyy-mm-dd
    if (!byDay.has(dateStr)) {
      byDay.set(dateStr, {
        date: dateStr,
        maxTemp: -Infinity,
        minTemp: Infinity,
        sumHumidity: 0,
        sumApparent: 0,
        count: 0,
        sumPrecip: 0,
      });
    }
    const row = byDay.get(dateStr);
    const t = temp[i];
    const h = humidity[i];
    const a = apparent[i];
    const p = precip[i];
    if (t != null && !Number.isNaN(t)) {
      row.maxTemp = Math.max(row.maxTemp, t);
      row.minTemp = Math.min(row.minTemp, t);
    }
    if (h != null && !Number.isNaN(h)) {
      row.sumHumidity += h;
      row.count++;
    }
    if (a != null && !Number.isNaN(a)) row.sumApparent += a;
    if (p != null && !Number.isNaN(p)) row.sumPrecip += p;
  }

  return Array.from(byDay.entries())
    .map(([date, row]) => ({
      date,
      maxTemp: row.maxTemp === -Infinity ? null : row.maxTemp,
      minTemp: row.minTemp === Infinity ? null : row.minTemp,
      meanHumidity: row.count ? row.sumHumidity / row.count : null,
      precipitationSum: row.sumPrecip,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Build SVG from Open-Meteo historical weather response.
 * @param {Object} data - Response from getHistoricalWeather / getWeatherByCity (includes locationName if by city)
 * @returns {string} SVG markup
 */
export function buildWeatherChartSvg(data) {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", {
    pretendToBeVisual: true,
  });
  const document = dom.window.document;

  const daily = aggregateHourlyToDaily(data);
  if (daily.length === 0) {
    throw new Error("No hourly data in response");
  }

  const locationName = data.locationName || data.timezone || "Unknown";
  const startDate = daily[0].date;
  const endDate = daily[daily.length - 1].date;
  const title = `Historical weather — ${locationName}`;
  const subtitle = `${startDate} to ${endDate}`;

  const chartWidth = WIDTH - MARGIN.left - MARGIN.right;
  const chartHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const xScale = d3
    .scaleBand()
    .domain(daily.map((d) => d.date))
    .range([0, chartWidth])
    .padding(0.25);

  const minTemps = daily.map((d) => d.minTemp).filter((v) => v != null);
  const maxTemps = daily.map((d) => d.maxTemp).filter((v) => v != null);
  const tempExtent = [
    minTemps.length ? Math.min(...minTemps) : 0,
    maxTemps.length ? Math.max(...maxTemps) : 20,
  ];
  const tempRange = tempExtent[1] - tempExtent[0] || 1;
  const yTemp = d3
    .scaleLinear()
    .domain([tempExtent[0] - 0.1 * tempRange, tempExtent[1] + 0.1 * tempRange])
    .range([chartHeight, 0]);

  const humidities = daily.map((d) => d.meanHumidity).filter((v) => v != null);
  const humidityMax = humidities.length ? Math.max(100, ...humidities) : 100;
  const yHumidity = d3
    .scaleLinear()
    .domain([0, humidityMax])
    .range([chartHeight, 0]);

  const body = d3.select(document.body);
  const svg = body
    .append("svg")
    .attr("xmlns", "http://www.w3.org/2000/svg")
    .attr("width", WIDTH)
    .attr("height", HEIGHT)
    .attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);

  svg
    .append("rect")
    .attr("width", WIDTH)
    .attr("height", HEIGHT)
    .attr("fill", "#1a1a2e");

  const g = svg
    .append("g")
    .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

  // Title & subtitle
  g.append("text")
    .attr("x", chartWidth / 2)
    .attr("y", -28)
    .attr("text-anchor", "middle")
    .attr("fill", "#eee")
    .attr("font-size", "18px")
    .attr("font-family", "system-ui, sans-serif")
    .text(title);
  g.append("text")
    .attr("x", chartWidth / 2)
    .attr("y", -10)
    .attr("text-anchor", "middle")
    .attr("fill", "#aaa")
    .attr("font-size", "13px")
    .attr("font-family", "system-ui, sans-serif")
    .text(subtitle);

  // Daily bars: max temp (red), min temp (blue), mean humidity (teal) as grouped bars per day
  const barWidth = xScale.bandwidth() / 3;
  const barPadding = 2;

  daily.forEach((d, i) => {
    const x = xScale(d.date) ?? 0;
    const group = g.append("g").attr("transform", `translate(${x},0)`);

    if (d.maxTemp != null) {
      group
        .append("rect")
        .attr("x", 0)
        .attr("y", yTemp(d.maxTemp))
        .attr("width", barWidth - barPadding)
        .attr("height", chartHeight - yTemp(d.maxTemp))
        .attr("fill", "#e74c3c")
        .attr("rx", 3);
    }
    if (d.minTemp != null) {
      group
        .append("rect")
        .attr("x", barWidth)
        .attr("y", yTemp(d.minTemp))
        .attr("width", barWidth - barPadding)
        .attr("height", chartHeight - yTemp(d.minTemp))
        .attr("fill", "#3498db")
        .attr("rx", 3);
    }
    if (d.meanHumidity != null) {
      group
        .append("rect")
        .attr("x", barWidth * 2)
        .attr("y", yHumidity(d.meanHumidity))
        .attr("width", barWidth - barPadding)
        .attr("height", chartHeight - yHumidity(d.meanHumidity))
        .attr("fill", "#2ecc71")
        .attr("rx", 3);
    }
  });

  // X axis (dates, shortened)
  const xAxis = g
    .append("g")
    .attr("transform", `translate(0,${chartHeight})`)
    .call(
      d3.axisBottom(xScale).tickFormat((d) => {
        const [y, m, day] = d.split("-");
        return `${m}/${day}`;
      })
    );
  xAxis.selectAll("text").attr("fill", "#aaa").attr("font-size", "11px").attr("font-family", "system-ui, sans-serif");
  xAxis.selectAll(".domain, .tick line").attr("stroke", "#444");

  // Left Y axis: temperature
  const yAxisLeft = g.append("g").call(d3.axisLeft(yTemp).ticks(6));
  yAxisLeft.selectAll("text").attr("fill", "#aaa").attr("font-size", "11px").attr("font-family", "system-ui, sans-serif");
  yAxisLeft.selectAll(".domain, .tick line").attr("stroke", "#444");

  // Legend
  const legend = g.append("g").attr("transform", `translate(0,${chartHeight + 38})`);
  const legendEntries = [
    { label: "Max temp (°C)", color: "#e74c3c" },
    { label: "Min temp (°C)", color: "#3498db" },
    { label: "Mean humidity (%)", color: "#2ecc71" },
  ];
  legend
    .selectAll("rect")
    .data(legendEntries)
    .join("rect")
    .attr("x", (_, i) => i * 140)
    .attr("y", 0)
    .attr("width", 12)
    .attr("height", 12)
    .attr("fill", (d) => d.color)
    .attr("rx", 2);
  legend
    .selectAll("text")
    .data(legendEntries)
    .join("text")
    .attr("x", (_, i) => i * 140 + 18)
    .attr("y", 10)
    .attr("fill", "#aaa")
    .attr("font-size", "11px")
    .attr("font-family", "system-ui, sans-serif")
    .text((d) => d.label);

  return body.select("svg").node().outerHTML;
}

// --- Year heatmap: one row per day (Jan–Dec), 24 cols per row (one per hour), noon centred ---
const CELL_SIZE = 8;
const HEATMAP_MARGIN = { top: 44, right: 20, bottom: 32, left: 20 };

/**
 * Default temperature colour scale matching the standard key: -40°C to 50°C.
 * Dark purple/indigo (cold) → blue → cyan → green → yellow → orange → red → dark red/black (hot).
 */
const TEMP_SCALE_DOMAIN = [
  -40, -35, -30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 28, 30, 32, 35, 40, 45, 50,
];
const TEMP_SCALE_RANGE = [
  "#1a0a2e", "#2d1b4e", "#3d2b5c", "#1e3a5f", "#1a5276", "#2874a6", "#2980b9", "#5dade2",
  "#48c9b0", "#1abc9c", "#27ae60", "#58d68d", "#d4e157", "#f4d03f", "#f5b041", "#e67e22",
  "#e74c3c", "#c0392b", "#922b21", "#641e16", "#2e0f0f",
];

function defaultTempColorScale() {
  const scale = d3
    .scaleLinear()
    .domain(TEMP_SCALE_DOMAIN)
    .range(TEMP_SCALE_RANGE)
    .clamp(true);
  return (temp) => {
    if (temp == null || Number.isNaN(temp)) return "#2d2d2d";
    return scale(temp);
  };
}

/**
 * Build a year heatmap SVG from Open-Meteo hourly data for a full year.
 * - One row = one day (Jan 1 top → Dec 31 bottom).
 * - One column = one hour; noon (12) is in the centre (columns ordered 0..23).
 * - Each cell colour = temperature (default blue–red scale).
 * @param {Object} data - Open-Meteo archive response with hourly.time and hourly.temperature_2m
 * @param {Object} [options] - { locationName, year, cellSize (px per square), cellBorderColor (hex, default #aaaaaa), colorScale (function temp => hex) }
 * @returns {string} SVG markup
 */
export function buildYearHeatmapSvg(data, options = {}) {
  const hourly = data.hourly;
  if (!hourly?.time?.length || !hourly?.temperature_2m) {
    throw new Error("Year heatmap requires hourly time and temperature_2m");
  }

  const cellSize = options.cellSize ?? CELL_SIZE;
  const cellBorderColor = options.cellBorderColor ?? "#aaaaaa";
  const time = hourly.time;
  const temp = hourly.temperature_2m;
  const locationName = options.locationName ?? data.locationName ?? data.timezone ?? "Unknown";
  const year = options.year ?? new Date().getFullYear();

  // Hour order: noon in centre → columns 0..23 = hours 0..23 (midnight at left, noon at column 12)
  const hourToCol = (hour) => Math.min(23, Math.max(0, hour));

  // Build sorted list of dates (YYYY-MM-DD) for the year
  const dateSet = new Set();
  for (let i = 0; i < time.length; i++) {
    dateSet.add(time[i].slice(0, 10));
  }
  const sortedDates = Array.from(dateSet).sort();
  const dateToRow = new Map(sortedDates.map((d, i) => [d, i]));
  const numRows = sortedDates.length;
  const numCols = 24;

  // grid[row][col] = temperature (null if missing)
  const grid = Array.from({ length: numRows }, () => Array(numCols).fill(null));
  let minT = Infinity;
  let maxT = -Infinity;

  for (let i = 0; i < time.length; i++) {
    const iso = time[i]; // "2024-07-15T14:00"
    const dateStr = iso.slice(0, 10);
    const hour = parseInt(iso.slice(11, 13), 10);
    const row = dateToRow.get(dateStr);
    if (row == null) continue;
    const col = hourToCol(hour);
    const t = temp[i];
    if (t != null && !Number.isNaN(t)) {
      grid[row][col] = t;
      minT = Math.min(minT, t);
      maxT = Math.max(maxT, t);
    }
  }

  if (minT === Infinity) minT = 0;
  if (maxT === -Infinity) maxT = 20;

  const getColor = options.colorScale ?? defaultTempColorScale();

  const width = numCols * cellSize + HEATMAP_MARGIN.left + HEATMAP_MARGIN.right;
  const height = numRows * cellSize + HEATMAP_MARGIN.top + HEATMAP_MARGIN.bottom;

  const dom = new JSDOM("<!DOCTYPE html><body></body>", { pretendToBeVisual: true });
  const document = dom.window.document;
  const body = d3.select(document.body);

  const svg = body
    .append("svg")
    .attr("xmlns", "http://www.w3.org/2000/svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`);

  svg.append("rect").attr("width", width).attr("height", height).attr("fill", "#1a1a2e");

  const g = svg
    .append("g")
    .attr("transform", `translate(${HEATMAP_MARGIN.left},${HEATMAP_MARGIN.top})`);

  // Title
  g.append("text")
    .attr("x", (numCols * cellSize) / 2)
    .attr("y", -22)
    .attr("text-anchor", "middle")
    .attr("fill", "#eee")
    .attr("font-size", "16px")
    .attr("font-family", "system-ui, sans-serif")
    .text(`Hourly temperature — ${locationName} — ${year}`);

  g.append("text")
    .attr("x", (numCols * cellSize) / 2)
    .attr("y", -6)
    .attr("text-anchor", "middle")
    .attr("fill", "#888")
    .attr("font-size", "11px")
    .attr("font-family", "system-ui, sans-serif")
    .text("Midnight ← hours → Noon (centre) → 11pm");

  // Cells (1px border around each square for clarity)
  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      const t = grid[row][col];
      g.append("rect")
        .attr("x", col * cellSize)
        .attr("y", row * cellSize)
        .attr("width", cellSize)
        .attr("height", cellSize)
        .attr("fill", getColor(t))
        .attr("stroke", cellBorderColor)
        .attr("stroke-width", 1);
    }
  }

  // Colour scale legend (horizontal bar below grid)
  const legendWidth = numCols * cellSize;
  const legendHeight = 14;
  const legendY = numRows * cellSize + 8;

  const legendN = 100;
  const defs = svg.append("defs");
  const gradientId = "year-heatmap-gradient";
  const gradient = defs
    .append("linearGradient")
    .attr("id", gradientId)
    .attr("x1", "0%")
    .attr("x2", "100%")
    .attr("y1", "0")
    .attr("y2", "0");
  const legendMin = -40;
  const legendMax = 50;
  for (let i = 0; i <= legendN; i++) {
    const v = legendMin + (i / legendN) * (legendMax - legendMin);
    gradient
      .append("stop")
      .attr("offset", `${(i / legendN) * 100}%`)
      .attr("stop-color", getColor(v));
  }

  g.append("rect")
    .attr("x", 0)
    .attr("y", legendY)
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .attr("fill", `url(#${gradientId})`)
    .attr("rx", 2);

  g.append("text")
    .attr("x", 0)
    .attr("y", legendY + legendHeight + 12)
    .attr("fill", "#888")
    .attr("font-size", "10px")
    .attr("font-family", "system-ui, sans-serif")
    .text(`${legendMin}°C`);

  g.append("text")
    .attr("x", legendWidth)
    .attr("y", legendY + legendHeight + 12)
    .attr("text-anchor", "end")
    .attr("fill", "#888")
    .attr("font-size", "10px")
    .attr("font-family", "system-ui, sans-serif")
    .text(`${legendMax}°C`);

  return body.select("svg").node().outerHTML;
}
