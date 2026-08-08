/**
 * @file ui.js
 * @description UI Rendering and DOM Management Module for City Brief Weather App.
 * Controls layout states (empty, loading, error, weather view), dynamic temperature unit formatting,
 * background backdrop state assignment, weather icon rendering, and DOM updates.
 */

// Ensure WeatherUtils is accessible from global window scope (loaded via script tag in index.html)
const WeatherUtils = (typeof window !== "undefined" && window.WeatherUtils) || {
  parseLocalDate: (d) => new Date(d),
};

const UNIT_CACHE_KEY = "city-brief:unit";

let currentUnit = localStorage.getItem(UNIT_CACHE_KEY) || "C";

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

// DOM Cache
const $ = (id) => document.getElementById(id);

export const elements = {
  searchInput: $("search-input"),
  suggestionsEl: $("suggestions"),
  locateBtn: $("locate-btn"),
  unitToggle: $("unit-toggle"),
  unitCLabel: $("unit-c-label"),
  unitFLabel: $("unit-f-label"),
  themeToggle: $("theme-toggle"),
  retryBtn: $("retry-btn"),
  offlineBadge: $("offline-badge"),
  errorMessage: $("error-message"),
  hourlyStrip: $("hourly-strip"),
  dailyList: $("daily-list"),
  states: {
    empty: $("empty-state"),
    loading: $("loading-state"),
    error: $("error-state"),
    weather: $("weather-view"),
  },
  hero: {
    location: $("location-name"),
    icon: $("hero-icon"),
    temp: $("hero-temp"),
    condition: $("hero-condition"),
    suggestion: $("hero-suggestion"),
    high: $("stat-high"),
    low: $("stat-low"),
    wind: $("stat-wind"),
  },
};

/**
 * Gets the active temperature unit ("C" or "F").
 * @returns {string}
 */
export function getUnit() {
  return currentUnit;
}

/**
 * Toggles the current unit between °C and °F.
 * @returns {string} - The new active unit
 */
export function toggleUnit() {
  currentUnit = currentUnit === "C" ? "F" : "C";
  localStorage.setItem(UNIT_CACHE_KEY, currentUnit);
  updateUnitToggleUI();
  return currentUnit;
}

/**
 * Updates the unit toggle button UI active state.
 */
export function updateUnitToggleUI() {
  if (elements.unitCLabel && elements.unitFLabel) {
    if (currentUnit === "F") {
      elements.unitCLabel.classList.remove("active");
      elements.unitFLabel.classList.add("active");
    } else {
      elements.unitCLabel.classList.add("active");
      elements.unitFLabel.classList.remove("active");
    }
  }
}

/**
 * Formats temperature in Celsius to the active unit string (°C or °F).
 * @param {number} tempC
 * @returns {string}
 */
export function formatTemp(tempC) {
  if (tempC === null || tempC === undefined || isNaN(tempC)) return "—°";
  if (currentUnit === "F") {
    const tempF = Math.round((tempC * 9) / 5 + 32);
    return `${tempF}°`;
  }
  return `${Math.round(tempC)}°`;
}

/**
 * Formats wind speed in km/h to the active unit string (km/h or mph).
 * @param {number} speedKmh
 * @returns {string}
 */
export function formatWind(speedKmh) {
  if (speedKmh === null || speedKmh === undefined || isNaN(speedKmh)) return "—";
  if (currentUnit === "F") {
    const mph = Math.round(speedKmh * 0.621371);
    return `${mph} mph`;
  }
  return `${Math.round(speedKmh)} km/h`;
}

/**
 * Returns an icon emoji for a given icon key and day/night state.
 * @param {string} key
 * @param {boolean} isDay
 * @returns {string}
 */
export function iconFor(key, isDay) {
  const entry = ICONS[key] || ICONS.unknown;
  return isDay ? entry.day : entry.night;
}

/**
 * Displays one of four main UI states: "empty", "loading", "error", "weather".
 * @param {string} name
 */
export function showState(name) {
  Object.entries(elements.states).forEach(([key, el]) => {
    if (el) el.hidden = key !== name;
  });
}

/**
 * Renders complete weather dataset to the DOM.
 * @param {object} data - Weather payload with location, current, hourly, and daily properties.
 */
export function renderWeatherData(data) {
  if (!data) return;
  const { location, current, hourly, daily } = data;
  const isDay = current.is_day;

  // Set weather mood backdrop attributes on body
  document.body.dataset.weather = CATEGORY_BY_ICON[current.icon] || "cloudy";
  document.body.dataset.period = isDay ? "day" : "night";

  // Update Hero elements
  elements.hero.location.textContent = location.name;
  elements.hero.icon.textContent = iconFor(current.icon, isDay);
  elements.hero.temp.textContent = formatTemp(current.temperature_c);
  elements.hero.condition.textContent = current.description;
  elements.hero.suggestion.textContent = current.suggestion;
  elements.hero.high.textContent = formatTemp(current.high_c);
  elements.hero.low.textContent = formatTemp(current.low_c);
  elements.hero.wind.textContent = formatWind(current.windspeed_kmh);

  // Render Hourly forecast strip
  elements.hourlyStrip.innerHTML = "";
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
    elements.hourlyStrip.appendChild(el);
  });

  // Render Daily 7-day forecast list
  elements.dailyList.innerHTML = "";
  daily.forEach((d, i) => {
    const el = document.createElement("li");
    const dateObj = WeatherUtils.parseLocalDate(d.date);
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
    elements.dailyList.appendChild(el);
  });

  showState("weather");
}
