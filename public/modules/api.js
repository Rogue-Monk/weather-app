/**
 * @file api.js
 * @description API Communication Module for City Brief Weather App.
 * Handles fetching dynamic session tokens from backend, routing requests via apiFetch,
 * and performing client-side direct Open-Meteo fallback when running on static hosts.
 */

import WeatherUtilsModule from "../weather-utils.js";

// Ensure WeatherUtils is accessible regardless of module loading context
const WeatherUtils = window.WeatherUtils || WeatherUtilsModule || {
  describeWeatherCode: (c) => ({ description: "Unknown", icon: "unknown", category: "cloudy" }),
  clothingSuggestion: () => "Dress comfortably",
  parseLocalDate: (d) => new Date(d),
};

const FETCH_TIMEOUT_MS = 8000;
const API_BASE = "";

// Dynamic session token issued by the backend (eliminates hardcoding static keys on frontend)
let sessionToken = null;

/**
 * Fetches an ephemeral session token from the backend /api/token endpoint.
 * @returns {Promise<string|null>}
 */
async function fetchSessionToken() {
  if (sessionToken) return sessionToken;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch("/api/token", { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      sessionToken = data.token;
      return sessionToken;
    }
  } catch (err) {
    // If backend isn't available or fails, return null for direct fallback
  }
  return null;
}

/**
 * Client-side fallback for static hosts (e.g., GitHub Pages).
 * Direct query to Open-Meteo & BigDataCloud APIs when Express API server is not available.
 * @param {string} path - Relative API endpoint path requested by client
 * @returns {Promise<any>}
 */
export async function fallbackDirectOpenMeteo(path) {
  const dummyOrigin = "http://localhost";
  const urlObj = new URL(path, dummyOrigin);

  // 1. Geocoding lookup
  if (urlObj.pathname.endsWith("/geocode")) {
    const q = (urlObj.searchParams.get("q") || "").trim();
    if (q.length < 2) return { results: [] };
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Location service unavailable");
    const data = await res.json();
    const results = (data.results || []).map((r) => ({
      name: r.name,
      country: r.country,
      admin1: r.admin1 || null,
      lat: r.latitude,
      lon: r.longitude,
    }));
    return { results };
  }

  // 2. Reverse geocoding lookup
  if (urlObj.pathname.endsWith("/reverse-geocode")) {
    const lat = parseFloat(urlObj.searchParams.get("lat"));
    const lon = parseFloat(urlObj.searchParams.get("lon"));
    try {
      const res = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      );
      if (res.ok) {
        const data = await res.json();
        const city = data.city || data.locality || "";
        const country = data.countryName || "";
        const admin = data.principalSubdivision || "";
        let name = city;
        if (!name) name = admin || country || "Your location";
        else if (country) name = `${city}, ${country}`;
        return { name, city, country };
      }
    } catch {
      // Ignore network errors in fallback mode
    }
    return { name: "Your location" };
  }

  // 3. Full weather forecast lookup
  if (urlObj.pathname.endsWith("/weather")) {
    const lat = parseFloat(urlObj.searchParams.get("lat"));
    const lon = parseFloat(urlObj.searchParams.get("lon"));
    const name = urlObj.searchParams.get("name") || "Selected location";

    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current_weather: "true",
      hourly: "temperature_2m,weathercode",
      daily: "weathercode,temperature_2m_max,temperature_2m_min",
      timezone: "auto",
      forecast_days: "7",
    });

    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!res.ok) throw new Error("Weather service unavailable");
    const data = await res.json();

    if (!data.current_weather) throw new Error("Unexpected response from weather service");

    const current = data.current_weather;
    const currentInfo = WeatherUtils.describeWeatherCode(current.weathercode);
    const nowHour = new Date(current.time).getHours();
    const isDaytime = current.is_day === 1 || (nowHour >= 6 && nowHour < 19);

    const nowIso = current.time;
    const startIdx = Math.max(0, data.hourly.time.findIndex((t) => t >= nowIso));
    const hourly = data.hourly.time.slice(startIdx, startIdx + 24).map((t, i) => {
      const idx = startIdx + i;
      const info = WeatherUtils.describeWeatherCode(data.hourly.weathercode[idx]);
      return {
        time: t,
        temperature_c: data.hourly.temperature_2m[idx],
        icon: info.icon,
      };
    });

    const daily = data.daily.time.map((t, idx) => {
      const info = WeatherUtils.describeWeatherCode(data.daily.weathercode[idx]);
      return {
        date: t,
        high_c: data.daily.temperature_2m_max[idx],
        low_c: data.daily.temperature_2m_min[idx],
        icon: info.icon,
        description: info.description,
      };
    });

    return {
      location: { name, lat, lon },
      current: {
        temperature_c: current.temperature,
        windspeed_kmh: current.windspeed,
        description: currentInfo.description,
        icon: currentInfo.icon,
        is_day: isDaytime,
        suggestion: WeatherUtils.clothingSuggestion(current.temperature, currentInfo.category),
        high_c: data.daily.temperature_2m_max[0],
        low_c: data.daily.temperature_2m_min[0],
      },
      hourly,
      daily,
    };
  }

  throw new Error(`Endpoint ${path} not found`);
}

/**
 * Universal fetch wrapper with timeout, authentication headers, and client fallback.
 * @param {string} path - API path (e.g., "/api/weather?lat=...")
 * @returns {Promise<any>}
 */
export async function apiFetch(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const targetUrl = API_BASE ? `${API_BASE.replace(/\/$/, "")}${path}` : path;

  // Retrieve ephemeral session token if available
  const token = await fetchSessionToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  try {
    const res = await fetch(targetUrl, {
      headers,
      signal: controller.signal,
    });

    // If endpoint returned 404 or authorization error when server isn't running
    if ((res.status === 404 || res.status === 401) && !API_BASE) {
      console.warn(`[City Brief] API route ${path} returned ${res.status}. Switching to direct fallback.`);
      return await fallbackDirectOpenMeteo(path);
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return body;
  } catch (err) {
    if (!API_BASE && err.name !== "AbortError") {
      try {
        return await fallbackDirectOpenMeteo(path);
      } catch (fallbackErr) {
        throw err;
      }
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
