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

    const autoIcon = themeToggle ? themeToggle.querySelector(".theme-icon-auto") : null;
    const sunIcon = themeToggle ? themeToggle.querySelector(".theme-icon-sun") : null;
    const moonIcon = themeToggle ? themeToggle.querySelector(".theme-icon-moon") : null;

    if (autoIcon) autoIcon.toggleAttribute("hidden", theme !== "auto");
    if (sunIcon) sunIcon.toggleAttribute("hidden", theme !== "light");
    if (moonIcon) moonIcon.toggleAttribute("hidden", theme !== "dark");

    if (theme === "dark") {
      document.body.dataset.theme = "dark";
      if (themeToggle) {
        themeToggle.title = "Theme: Dark Mode — Click to switch to Light Mode";
        themeToggle.setAttribute("aria-label", "Theme: Dark Mode. Click to switch to Light Mode");
      }
    } else if (theme === "light") {
      document.body.dataset.theme = "light";
      if (themeToggle) {
        themeToggle.title = "Theme: Light Mode — Click to switch to Weather Sky Mode";
        themeToggle.setAttribute("aria-label", "Theme: Light Mode. Click to switch to Weather Sky Mode");
      }
    } else {
      // Auto theme: remove data-theme so weather sky gradient takes full effect
      delete document.body.dataset.theme;
      if (themeToggle) {
        themeToggle.title = "Theme: Weather Sky (Auto) — Click to switch to Dark Mode";
        themeToggle.setAttribute("aria-label", "Theme: Weather Sky Auto Mode. Click to switch to Dark Mode");
      }
    }
  }

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      themeToggle.classList.add("theme-animating");
      setTimeout(() => themeToggle.classList.remove("theme-animating"), 500);

      document.body.classList.add("theme-transition");
      setTimeout(() => document.body.classList.remove("theme-transition"), 600);

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
  // Unit conversion helpers
  // ---------------------------------------------------------------------
  function formatTemp(tempC) {
    if (tempC === null || tempC === undefined || isNaN(tempC)) return "—°";
    if (currentUnit === "F") {
      const tempF = Math.round((tempC * 9) / 5 + 32);
      return `${tempF}°`;
    }
    return `${Math.round(tempC)}°`;
  }

  function formatWind(speedKmh) {
    if (speedKmh === null || speedKmh === undefined || isNaN(speedKmh)) return "—";
    if (currentUnit === "F") {
      const mph = Math.round(speedKmh * 0.621371);
      return `${mph} mph`;
    }
    return `${Math.round(speedKmh)} km/h`;
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
  const { describeWeatherCode, clothingSuggestion, parseLocalDate } = window.WeatherUtils || {
    describeWeatherCode: (c) => ({ description: "Unknown", icon: "unknown", category: "cloudy" }),
    clothingSuggestion: () => "Dress comfortably",
    parseLocalDate: (d) => new Date(d),
  };

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
        // Ignore network errors in fallback
      }
      return { name: "Your location" };
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
      const hourly = data.hourly.time.slice(startIdx, startIdx + 24).map((t, i) => {
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
    heroEls.wind.textContent = formatWind(current.windspeed_kmh);

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
      const dateObj = parseLocalDate(d.date);
      const dayName =
        i === 0
          ? "Today"
          : dateObj.toLocaleDateString("en-US", { weekday: "short" });
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
  const searchContainer = document.querySelector(".search");
  let debounceTimer = null;
  let activeIndex = -1;
  let currentResults = [];

  function closeSuggestions() {
    suggestionsEl.hidden = true;
    suggestionsEl.innerHTML = "";
    activeIndex = -1;
    if (searchContainer) searchContainer.setAttribute("aria-expanded", "false");
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
        <li role="option" id="opt-${i}" data-index="${i}" aria-selected="false">
          <span>${r.name}</span>
          <span class="place-region">${[r.admin1, r.country].filter(Boolean).join(", ")}</span>
        </li>
      `,
      )
      .join("");
    suggestionsEl.hidden = false;
    if (searchContainer) searchContainer.setAttribute("aria-expanded", "true");
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
    items.forEach((li, i) => {
      const isSelected = i === activeIndex;
      li.setAttribute("aria-selected", isSelected);
      if (isSelected) {
        li.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
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
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        let placeName = "Your location";

        try {
          const geoRes = await apiFetch(`/api/reverse-geocode?lat=${lat}&lon=${lon}`);
          if (geoRes && geoRes.name) {
            placeName = geoRes.name;
          }
        } catch (err) {
          // If reverse geocoding fails, fallback gracefully to "Your location"
        }

        locateBtn.classList.remove("locating");
        searchInput.value = "";
        loadWeather(lat, lon, placeName);
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
