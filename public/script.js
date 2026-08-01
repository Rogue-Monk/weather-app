(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------
  // This key gates the API against random bots hitting it directly — it is
  // NOT a secret once shipped to a browser (anyone can read it in devtools'
  // Network tab). Real protection for a public-facing app like this comes
  // from the rate limiter on the server, not from hiding this string. If
  // you later want this to be a real secret, move weather calls behind a
  // session cookie instead of a static bearer token.
  const API_KEY = "cbb3143c5782cdc9c512d7374493be13d7ad867760de2573"; // must match .env
  const FETCH_TIMEOUT_MS = 8000;
  const CACHE_KEY = "city-brief:last-result";

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  const searchInput = $("search-input");
  const suggestionsEl = $("suggestions");
  const locateBtn = $("locate-btn");
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
  // Fetch helper with timeout + auth header baked in
  // ---------------------------------------------------------------------
  async function apiFetch(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(path, {
        headers: { Authorization: `Bearer ${API_KEY}` },
        signal: controller.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      return body;
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
    const { location, current, hourly, daily } = data;
    const isDay = current.is_day;

    document.body.dataset.weather = CATEGORY_BY_ICON[current.icon] || "cloudy";
    document.body.dataset.period = isDay ? "day" : "night";

    heroEls.location.textContent = location.name;
    heroEls.icon.textContent = iconFor(current.icon, isDay);
    heroEls.temp.textContent = `${Math.round(current.temperature_c)}°`;
    heroEls.condition.textContent = current.description;
    heroEls.suggestion.textContent = current.suggestion;
    heroEls.high.textContent = `${Math.round(current.high_c)}°`;
    heroEls.low.textContent = `${Math.round(current.low_c)}°`;
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
        <span class="hour-temp">${Math.round(h.temperature_c)}°</span>
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
        <span class="day-temps"><span class="high">${Math.round(d.high_c)}°</span><span class="low">${Math.round(d.low_c)}°</span></span>
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
