(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------
  // API_BASE configuration:
  // - Leave empty ("") for local Express development (`node server.js`) or automatic fallback.
  // - Set to your deployed backend URL (e.g. "https://your-backend.onrender.com") if hosting
  //   the Express server on a separate cloud provider.
  const API_BASE = "";
  const API_KEY = "cbb3143c5782cdc9c512d7374493be13d7ad867760de2573"; // must match .env
  const FETCH_TIMEOUT_MS = 8000;
  const CACHE_KEY = "city-brief:last-result";
  const UNIT_CACHE_KEY = "city-brief:unit";
  const THEME_CACHE_KEY = "city-brief:theme";

  // ---------------------------------------------------------------------
  // State & Preferences
  // ---------------------------------------------------------------------
  let currentUnit = localStorage.getItem(UNIT_CACHE_KEY) || "C";
  let currentTheme = localStorage.getItem(THEME_CACHE_KEY) || "auto"; // "auto", "dark", "light"
  let activeWeatherData = null;

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  const searchInput = $("search-input");
  const suggestionsEl = $("suggestions");
  const locateBtn = $("locate-btn");
  const unitToggle = $("unit-toggle");
  const unitCLabel = $("unit-c-label");
  const unitFLabel = $("unit-f-label");
  const themeToggle = $("theme-toggle");
  const retryBtn = $("retry-btn");
  const offlineBadge = $("offline-badge");

  const states = {
    empty: $("empty-state"),
    loading: $("loading-state"),
    error: $("error-state"),
    weather: $("weather-view"),
  };

  const heroEls = {
    location: $("location-name"),
    icon: $("hero-icon"),
    temp: $("hero-temp"),
    condition: $("hero-condition"),
    suggestion: $("hero-suggestion"),
    high: $("stat-high"),
    low: $("stat-low"),
    wind: $("stat-wind"),
  };

  const hourlyStrip = $("hourly-strip");
  const dailyList = $("daily-list");
  const errorMessage = $("error-message");

  // ---------------------------------------------------------------------
  // Theme Switcher Logic
  // ---------------------------------------------------------------------
  function applyTheme(theme) {
    currentTheme = theme;
    localStorage.setItem(THEME_CACHE_KEY, theme);

    const sunIcon = themeToggle ? themeToggle.querySelector(".theme-icon-sun") : null;
    const moonIcon = themeToggle ? themeToggle.querySelector(".theme-icon-moon") : null;

    if (theme === "dark") {
      document.body.dataset.theme = "dark";
      if (sunIcon) sunIcon.hidden = true;
      if (moonIcon) moonIcon.hidden = false;
      if (themeToggle) themeToggle.title = "Theme: Dark Mode (click to switch to Light)";
    } else if (theme === "light") {
      document.body.dataset.theme = "light";
      if (sunIcon) sunIcon.hidden = false;
      if (moonIcon) moonIcon.hidden = true;
      if (themeToggle) themeToggle.title = "Theme: Light Mode (click to switch to Auto)";
    } else {
      // Auto theme: remove data-theme so weather sky gradient takes full effect
      delete document.body.dataset.theme;
      if (sunIcon) sunIcon.hidden = false;
      if (moonIcon) moonIcon.hidden = true;
      if (themeToggle) themeToggle.title = "Theme: Weather Sky (click to switch to Dark)";
    }
  }

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      if (currentTheme === "auto" || !currentTheme) {
        applyTheme("dark");
      } else if (currentTheme === "dark") {
        applyTheme("light");
      } else {
        applyTheme("auto");
      }
    });
  }

  // Apply initial theme
  applyTheme(currentTheme);

  // ---------------------------------------------------------------------
  // Unit conversion helper
  // ---------------------------------------------------------------------
  function formatTemp(tempC) {
    if (tempC === null || tempC === undefined || isNaN(tempC)) return "—°";
    if (currentUnit === "F") {
      const tempF = Math.round((tempC * 9) / 5 + 32);
      return `${tempF}°`;
    }
    return `${Math.round(tempC)}°`;
  }

  function updateUnitToggleUI() {
    if (unitCLabel && unitFLabel) {
      if (currentUnit === "F") {
        unitCLabel.classList.remove("active");
        unitFLabel.classList.add("active");
      } else {
        unitCLabel.classList.add("active");
        unitFLabel.classList.remove("active");
      }
    }
  }

  if (unitToggle) {
    unitToggle.addEventListener("click", () => {
      currentUnit = currentUnit === "C" ? "F" : "C";
      localStorage.setItem(UNIT_CACHE_KEY, currentUnit);
      updateUnitToggleUI();
      if (activeWeatherData) {
        render(activeWeatherData);
      }
    });
  }

  // Initial unit UI update
  updateUnitToggleUI();

  // ---------------------------------------------------------------------
  // Icon mapping (icon key + day/night -> emoji)
  // ---------------------------------------------------------------------
  const ICONS = {
    clear: { day: "☀️", night: "🌙" },
    "partly-cloudy": { day: "🌤️", night: "🌥️" },
    cloudy: { day: "☁️", night: "☁️" },
    fog: { day: "🌫️", night: "🌫️" },
    drizzle: { day: "🌦️", night: "🌦️" },
    rain: { day: "🌧️", night: "🌧️" },
    snow: { day: "❄️", night: "❄️" },
    storm: { day: "⛈️", night: "⛈️" },
    unknown: { day: "❔", night: "❔" },
  };

  function iconFor(key, isDay) {
    const entry = ICONS[key] || ICONS.unknown;
    return isDay ? entry.day : entry.night;
  }

  // Icon key -> a background "mood" category, matched to the CSS gradients.
  const CATEGORY_BY_ICON = {
    clear: "clear",
    "partly-cloudy": "clear",
    cloudy: "cloudy",
    fog: "fog",
    drizzle: "rain",
    rain: "rain",
    snow: "snow",
    storm: "storm",
    unknown: "cloudy",
  };

  // ---------------------------------------------------------------------
  // Client-side fallback for static hosts (e.g. GitHub Pages)
  // When running on GitHub Pages without a deployed Express server, GitHub Pages
  // returns 404 for `/api/...`. This fallback queries Open-Meteo APIs directly.
  // ---------------------------------------------------------------------
  const WEATHER_CODES = {
    0: { description: "Clear sky", icon: "clear", category: "clear" },
    1: { description: "Mostly clear", icon: "partly-cloudy", category: "clear" },
    2: { description: "Partly cloudy", icon: "partly-cloudy", category: "cloudy" },
    3: { description: "Overcast", icon: "cloudy", category: "cloudy" },
    45: { description: "Fog", icon: "fog", category: "fog" },
    48: { description: "Depositing rime fog", icon: "fog", category: "fog" },
    51: { description: "Light drizzle", icon: "drizzle", category: "rain" },
    53: { description: "Moderate drizzle", icon: "drizzle", category: "rain" },
    55: { description: "Dense drizzle", icon: "drizzle", category: "rain" },
    56: { description: "Light freezing drizzle", icon: "drizzle", category: "rain" },
    57: { description: "Dense freezing drizzle", icon: "drizzle", category: "rain" },
    61: { description: "Slight rain", icon: "rain", category: "rain" },
    63: { description: "Moderate rain", icon: "rain", category: "rain" },
    65: { description: "Heavy rain", icon: "rain", category: "rain" },
    66: { description: "Light freezing rain", icon: "rain", category: "rain" },
    67: { description: "Heavy freezing rain", icon: "rain", category: "rain" },
    71: { description: "Slight snow", icon: "snow", category: "snow" },
    73: { description: "Moderate snow", icon: "snow", category: "snow" },
    75: { description: "Heavy snow", icon: "snow", category: "snow" },
    77: { description: "Snow grains", icon: "snow", category: "snow" },
    80: { description: "Slight rain showers", icon: "rain", category: "rain" },
    81: { description: "Moderate rain showers", icon: "rain", category: "rain" },
    82: { description: "Violent rain showers", icon: "rain", category: "rain" },
    85: { description: "Slight snow showers", icon: "snow", category: "snow" },
    86: { description: "Heavy snow showers", icon: "snow", category: "snow" },
    95: { description: "Thunderstorm", icon: "storm", category: "storm" },
    96: { description: "Thunderstorm with light hail", icon: "storm", category: "storm" },
    99: { description: "Thunderstorm with heavy hail", icon: "storm", category: "storm" },
  };

  function describeWeatherCode(code) {
    return (
      WEATHER_CODES[code] || {
        description: "Unknown",
        icon: "unknown",
        category: "cloudy",
      }
    );
  }

  function clothingSuggestion(tempC, category) {
    if (category === "storm") return "Stay in if you can — thunderstorm conditions";
    if (category === "snow") return "Bundle up, snow is falling";
    if (category === "rain") return "Grab an umbrella, it's wet out there";
    if (tempC < 5) return "Heavy coat weather";
    if (tempC < 15) return "A jacket will do";
    if (tempC < 25) return "Light layers are enough";
    return "It's shorts weather";
  }

  async function fallbackDirectOpenMeteo(path) {
    const dummyOrigin = "http://localhost";
    const urlObj = new URL(path, dummyOrigin);

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
      const currentInfo = describeWeatherCode(current.weathercode);
      const nowHour = new Date(current.time).getHours();
      const isDaytime = current.is_day === 1 || (nowHour >= 6 && nowHour < 19);

      const nowIso = current.time;
      const startIdx = Math.max(0, data.hourly.time.findIndex((t) => t >= nowIso));
      const hourly = data.hourly.time.slice(startIdx, startIdx + 12).map((t, i) => {
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

      return {
        location: { name, lat, lon },
        current: {
          temperature_c: current.temperature,
          windspeed_kmh: current.windspeed,
          description: currentInfo.description,
          icon: currentInfo.icon,
          is_day: isDaytime,
          suggestion: clothingSuggestion(current.temperature, currentInfo.category),
          high_c: data.daily.temperature_2m_max[0],
          low_c: data.daily.temperature_2m_min[0],
        },
        hourly,
        daily,
      };
    }

    throw new Error(`Endpoint ${path} not found`);
  }

  // ---------------------------------------------------------------------
  // Fetch helper with timeout + auth header baked in
  // ---------------------------------------------------------------------
  async function apiFetch(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const targetUrl = API_BASE ? `${API_BASE.replace(/\/$/, "")}${path}` : path;

    try {
      const res = await fetch(targetUrl, {
        headers: { Authorization: `Bearer ${API_KEY}` },
        signal: controller.signal,
      });

      // If hosting statically (GitHub Pages) without Express running at targetUrl, 404 occurs.
      if (res.status === 404 && !API_BASE) {
        console.warn(`[City Brief] Backend route ${path} returned 404. Falling back to direct Open-Meteo client API.`);
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

  // ---------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------
  function showState(name) {
    Object.entries(states).forEach(([key, el]) => {
      el.hidden = key !== name;
    });
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function render(data) {
    activeWeatherData = data;
    const { location, current, hourly, daily } = data;
    const isDay = current.is_day;

    document.body.dataset.weather = CATEGORY_BY_ICON[current.icon] || "cloudy";
    document.body.dataset.period = isDay ? "day" : "night";

    heroEls.location.textContent = location.name;
    heroEls.icon.textContent = iconFor(current.icon, isDay);
    heroEls.temp.textContent = formatTemp(current.temperature_c);
    heroEls.condition.textContent = current.description;
    heroEls.suggestion.textContent = current.suggestion;
    heroEls.high.textContent = formatTemp(current.high_c);
    heroEls.low.textContent = formatTemp(current.low_c);
    heroEls.wind.textContent = `${Math.round(current.windspeed_kmh)} km/h`;

    hourlyStrip.innerHTML = "";
    hourly.forEach((h) => {
      const el = document.createElement("div");
      el.className = "hour-item";
      const hour = new Date(h.time).getHours();
      const label =
        hour === 0
          ? "12AM"
          : hour < 12
            ? `${hour}AM`
            : hour === 12
              ? "12PM"
              : `${hour - 12}PM`;
      el.innerHTML = `
        <span class="hour-label">${label}</span>
        <span class="hour-icon">${iconFor(h.icon, true)}</span>
        <span class="hour-temp">${formatTemp(h.temperature_c)}</span>
      `;
      hourlyStrip.appendChild(el);
    });

    dailyList.innerHTML = "";
    daily.forEach((d, i) => {
      const el = document.createElement("li");
      const dayName =
        i === 0
          ? "Today"
          : new Date(d.date).toLocaleDateString("en-US", { weekday: "short" });
      el.innerHTML = `
        <span class="day-name">${dayName}</span>
        <span class="day-icon">${iconFor(d.icon, true)}</span>
        <span class="day-desc">${d.description}</span>
        <span class="day-temps"><span class="high">${formatTemp(d.high_c)}</span><span class="low">${formatTemp(d.low_c)}</span></span>
      `;
      dailyList.appendChild(el);
    });

    showState("weather");
  }

  // ---------------------------------------------------------------------
  // Core flow: fetch weather for a place, with cache + offline fallback
  // ---------------------------------------------------------------------
  let lastRequest = null;

  async function loadWeather(lat, lon, name) {
    lastRequest = { lat, lon, name };
    showState("loading");

    if (!navigator.onLine) {
      return handleFailure("You're offline. Reconnect to load new weather.");
    }

    try {
      const data = await apiFetch(
        `/api/weather?lat=${lat}&lon=${lon}&name=${encodeURIComponent(name)}`,
      );
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ data, savedAt: Date.now() }),
      );
      offlineBadge.hidden = true;
      render(data);
    } catch (err) {
      handleFailure(err.message);
    }
  }

  function handleFailure(message) {
    const cached = readCache();
    if (cached) {
      render(cached.data);
      offlineBadge.hidden = false;
      return;
    }
    errorMessage.textContent =
      message || "Can't reach the weather service right now.";
    showState("error");
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // Search + autocomplete
  // ---------------------------------------------------------------------
  let debounceTimer = null;
  let activeIndex = -1;
  let currentResults = [];

  function closeSuggestions() {
    suggestionsEl.hidden = true;
    suggestionsEl.innerHTML = "";
    activeIndex = -1;
  }

  function renderSuggestions(results) {
    currentResults = results;
    if (!results.length) {
      closeSuggestions();
      return;
    }
    suggestionsEl.innerHTML = results
      .map(
        (r, i) => `
        <li role="option" data-index="${i}">
          <span>${r.name}</span>
          <span class="place-region">${[r.admin1, r.country].filter(Boolean).join(", ")}</span>
        </li>
      `,
      )
      .join("");
    suggestionsEl.hidden = false;
  }

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim();
    clearTimeout(debounceTimer);
    if (q.length < 2) {
      closeSuggestions();
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        const { results } = await apiFetch(
          `/api/geocode?q=${encodeURIComponent(q)}`,
        );
        renderSuggestions(results || []);
      } catch {
        closeSuggestions(); // a failed autocomplete shouldn't block the whole app
      }
    }, 300);
  });

  suggestionsEl.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    selectResult(currentResults[Number(li.dataset.index)]);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (suggestionsEl.hidden) return;
    const items = [...suggestionsEl.children];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      selectResult(currentResults[activeIndex]);
      return;
    } else if (e.key === "Escape") {
      closeSuggestions();
      return;
    } else {
      return;
    }
    items.forEach((li, i) =>
      li.setAttribute("aria-selected", i === activeIndex),
    );
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search")) closeSuggestions();
  });

  function selectResult(place) {
    if (!place) return;
    searchInput.value = place.name;
    closeSuggestions();
    loadWeather(place.lat, place.lon, place.name);
  }

  // ---------------------------------------------------------------------
  // Geolocation
  // ---------------------------------------------------------------------
  locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      handleFailure("Location access is not supported in this browser.");
      return;
    }
    locateBtn.classList.add("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locateBtn.classList.remove("locating");
        searchInput.value = "";
        loadWeather(pos.coords.latitude, pos.coords.longitude, "Your location");
      },
      () => {
        locateBtn.classList.remove("locating");
        handleFailure(
          "Location permission was denied — try searching instead.",
        );
      },
      { timeout: 8000 },
    );
  });

  // ---------------------------------------------------------------------
  // Online / offline + retry
  // ---------------------------------------------------------------------
  window.addEventListener("offline", () => {
    offlineBadge.hidden = !readCache();
  });

  window.addEventListener("online", () => {
    offlineBadge.hidden = true;
    if (lastRequest)
      loadWeather(lastRequest.lat, lastRequest.lon, lastRequest.name);
  });

  retryBtn.addEventListener("click", () => {
    if (lastRequest) {
      loadWeather(lastRequest.lat, lastRequest.lon, lastRequest.name);
    } else {
      showState("empty");
    }
  });

  // ---------------------------------------------------------------------
  // Boot: show cached result immediately if we have one, otherwise empty
  // ---------------------------------------------------------------------
  (function boot() {
    const cached = readCache();
    if (cached) {
      lastRequest = {
        lat: cached.data.location.lat,
        lon: cached.data.location.lon,
        name: cached.data.location.name,
      };
      render(cached.data);
      if (!navigator.onLine) offlineBadge.hidden = false;
    } else {
      showState("empty");
    }
  })();
})();
