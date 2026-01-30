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
