require("dotenv").config();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  // Fail loudly at boot rather than silently letting an unprotected API run.
  console.error("Missing API_KEY. Copy .env.example to .env and set one.");
  process.exit(1);
}

const { describeWeatherCode, clothingSuggestion } = require("./public/weather-utils");

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down and try again shortly." },
});

function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token || token !== API_KEY) {
    return res
      .status(401)
      .json({ error: "Unauthorized — missing or invalid API key" });
  }
  next();
}

// Wraps an async route handler so a rejected promise (a failed fetch, a bad
// parse) lands in Express's error handler instead of hanging the request or
// crashing the process.
function asyncRoute(handler) {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

// Fetch with a timeout, so a slow upstream API can't hang a request forever.
async function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

app.use("/api", apiLimiter, requireAuth);

// ---------------------------------------------------------------------------
// GET /api/geocode?q=<city name>
// Proxies Open-Meteo's geocoding search so the frontend never needs its own
// key or rate-limit budget against a third party directly.
// ---------------------------------------------------------------------------
app.get(
  "/api/geocode",
  asyncRoute(async (req, res) => {
    const q = (req.query.q || "").trim();
    if (q.length < 2) {
      return res
        .status(400)
        .json({ error: "Query must be at least 2 characters" });
    }

    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
    const upstream = await fetchWithTimeout(url);

    if (!upstream.ok) {
      return res
        .status(502)
        .json({ error: "Location service is unavailable right now" });
    }

    const data = await upstream.json();
    const results = (data.results || []).map((r) => ({
      name: r.name,
      country: r.country,
      admin1: r.admin1 || null,
      lat: r.latitude,
      lon: r.longitude,
    }));

    res.json({ results });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/reverse-geocode?lat=&lon=
// Resolves GPS coordinates into a human-readable city/region name.
// ---------------------------------------------------------------------------
app.get(
  "/api/reverse-geocode",
  asyncRoute(async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);

    if (
      Number.isNaN(lat) ||
      Number.isNaN(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      return res
        .status(400)
        .json({ error: "lat and lon must be valid coordinates" });
    }

    try {
      const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
      const upstream = await fetchWithTimeout(url, 5000);

      if (upstream.ok) {
        const data = await upstream.json();
        const city = data.city || data.locality || "";
        const country = data.countryName || "";
        const admin = data.principalSubdivision || "";

        let name = city;
        if (!name) name = admin || country || "Your location";
        else if (country) name = `${city}, ${country}`;

        return res.json({ name, city, country });
      }
    } catch (err) {
      // Fallback if reverse geocode service fails
    }

    res.json({ name: "Your location" });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/weather?lat=&lon=&name=
// Fetches current + hourly + daily forecast and reshapes it into one clean,
// UI-ready payload with human-readable conditions and a clothing suggestion.
// ---------------------------------------------------------------------------
app.get(
  "/api/weather",
  asyncRoute(async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const name = req.query.name || "Selected location";

    if (
      Number.isNaN(lat) ||
      Number.isNaN(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      return res
        .status(400)
        .json({ error: "lat and lon must be valid coordinates" });
    }

    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current_weather: "true",
      hourly: "temperature_2m,weathercode",
      daily: "weathercode,temperature_2m_max,temperature_2m_min",
      timezone: "auto",
      forecast_days: "7",
    });

    const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
    const upstream = await fetchWithTimeout(url);

    if (!upstream.ok) {
      return res
        .status(502)
        .json({ error: "Weather service is unavailable right now" });
    }

    const data = await upstream.json();

    if (!data.current_weather) {
      return res
        .status(502)
        .json({ error: "Weather service returned an unexpected response" });
    }

    const current = data.current_weather;
    const currentInfo = describeWeatherCode(current.weathercode);
    const nowHour = new Date(current.time).getHours();
    const isDaytime = current.is_day === 1 || (nowHour >= 6 && nowHour < 19);

    // Find today's index in the daily arrays so "feels like" high/low match today.
    const todayIndex = 0;

    // Build the next 24 hours of hourly data, starting from the current hour.
    const nowIso = current.time;
    const startIdx = Math.max(
      0,
      data.hourly.time.findIndex((t) => t >= nowIso),
    );
    const hourly = data.hourly.time
      .slice(startIdx, startIdx + 24)
      .map((t, i) => {
        const idx = startIdx + i;
        const info = describeWeatherCode(data.hourly.weathercode[idx]);
        return {
          time: t,
          temperature_c: data.hourly.temperature_2m[idx],
          icon: info.icon,
        };
      });

    const daily = data.daily.time.map((t, idx) => {
      const info = describeWeatherCode(data.daily.weathercode[idx]);
      return {
        date: t,
        high_c: data.daily.temperature_2m_max[idx],
        low_c: data.daily.temperature_2m_min[idx],
        icon: info.icon,
        description: info.description,
      };
    });

    res.json({
      location: { name, lat, lon },
      current: {
        temperature_c: current.temperature,
        windspeed_kmh: current.windspeed,
        description: currentInfo.description,
        icon: currentInfo.icon,
        is_day: isDaytime,
        suggestion: clothingSuggestion(
          current.temperature,
          currentInfo.category,
        ),
        high_c: data.daily.temperature_2m_max[todayIndex],
        low_c: data.daily.temperature_2m_min[todayIndex],
      },
      hourly,
      daily,
    });
  }),
);

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------
app.use(express.static("public"));

// 404 for unmatched API routes (keep this after the routes, before the error handler)
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Centralized error handler — anything thrown or rejected in an asyncRoute
// lands here instead of crashing the process or hanging the client.
app.use((err, req, res, next) => {
  console.error(err);
  if (err.name === "AbortError") {
    return res.status(504).json({ error: "Upstream request timed out" });
  }
  res.status(500).json({ error: "Something went wrong on our end" });
});

app.listen(PORT, () => {
  console.log(`City Brief running on http://localhost:${PORT}`);
});
