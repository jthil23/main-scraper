import { getMetricsPool, getSourceId, logScrape } from "../db/connection.js";
import { config } from "../config.js";

const BASE_URL = "https://api.open-meteo.com/v1";

interface OpenMeteoResponse {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    surface_pressure: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    precipitation: number;
    cloud_cover: number;
    weather_code: number;
    uv_index: number;
    visibility: number;
  };
}

function weatherCodeToCondition(code: number): string {
  const conditions: Record<number, string> = {
    0: "Clear", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
    45: "Foggy", 48: "Rime Fog", 51: "Light Drizzle", 53: "Drizzle",
    55: "Heavy Drizzle", 61: "Light Rain", 63: "Rain", 65: "Heavy Rain",
    71: "Light Snow", 73: "Snow", 75: "Heavy Snow", 77: "Snow Grains",
    80: "Light Showers", 81: "Showers", 82: "Heavy Showers",
    85: "Light Snow Showers", 86: "Snow Showers",
    95: "Thunderstorm", 96: "Thunderstorm w/ Hail", 99: "Thunderstorm w/ Heavy Hail",
  };
  return conditions[code] || "Unknown";
}

function cToF(c: number): number {
  return (c * 9 / 5) + 32;
}

function kmhToMph(kmh: number): number {
  return kmh * 0.621371;
}

export async function scrapeCurrentWeather(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    const sourceId = await getSourceId("weather_local");

    const params = new URLSearchParams({
      latitude: config.weather.latitude.toString(),
      longitude: config.weather.longitude.toString(),
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,precipitation,cloud_cover,weather_code,uv_index,visibility",
      timezone: "auto",
    });

    const res = await fetch(`${BASE_URL}/forecast?${params}`);
    if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`);

    const data: OpenMeteoResponse = await res.json();
    const c = data.current;

    await pool.execute(
      `INSERT INTO weather_readings
       (source_id, temperature_f, feels_like_f, humidity, pressure_hpa, wind_speed_mph, wind_direction, conditions, uv_index, visibility_mi, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        sourceId,
        cToF(c.temperature_2m),
        cToF(c.apparent_temperature),
        c.relative_humidity_2m,
        c.surface_pressure,
        kmhToMph(c.wind_speed_10m),
        c.wind_direction_10m,
        weatherCodeToCondition(c.weather_code),
        c.uv_index,
        (c.visibility / 1000) * 0.621371, // meters -> miles
      ]
    );

    await logScrape("weather_current", 1, "success", startedAt);
    console.log(`[Weather] ${cToF(c.temperature_2m).toFixed(1)}°F, ${weatherCodeToCondition(c.weather_code)}`);
    return 1;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Weather] Error:", msg);
    await logScrape("weather_current", 0, "error", startedAt, msg);
    return 0;
  }
}

export async function scrapeAirQuality(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    const sourceId = await getSourceId("air_quality_local");

    const params = new URLSearchParams({
      latitude: config.weather.latitude.toString(),
      longitude: config.weather.longitude.toString(),
      current: "us_aqi,pm2_5,pm10,ozone",
    });

    const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
    if (!res.ok) throw new Error(`Open-Meteo AQ error: ${res.status}`);

    const data = await res.json() as {
      current: { us_aqi: number; pm2_5: number; pm10: number; ozone: number };
    };
    const aq = data.current;

    let category = "Good";
    if (aq.us_aqi > 300) category = "Hazardous";
    else if (aq.us_aqi > 200) category = "Very Unhealthy";
    else if (aq.us_aqi > 150) category = "Unhealthy";
    else if (aq.us_aqi > 100) category = "Unhealthy for Sensitive";
    else if (aq.us_aqi > 50) category = "Moderate";

    const pollutants = { pm25: aq.pm2_5, pm10: aq.pm10, ozone: aq.ozone };
    const dominant = Object.entries(pollutants).sort(([, a], [, b]) => b - a)[0][0];

    await pool.execute(
      `INSERT INTO air_quality_readings
       (source_id, aqi, category, dominant_pollutant, pm25, pm10, ozone, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [sourceId, aq.us_aqi, category, dominant, aq.pm2_5, aq.pm10, aq.ozone]
    );

    await logScrape("air_quality", 1, "success", startedAt);
    console.log(`[Weather] AQI: ${aq.us_aqi} (${category})`);
    return 1;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Weather] AQ Error:", msg);
    await logScrape("air_quality", 0, "error", startedAt, msg);
    return 0;
  }
}
