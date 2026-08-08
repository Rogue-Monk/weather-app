/**
 * @file app.js
 * @description Main Application Orchestration Module for City Brief Weather App.
 * Coordinates input debouncing, autocomplete suggestions, geolocation, cache TTL,
 * network event handlers, unit switching, theme initialization, and boot sequences.
 */

import { apiFetch } from "./api.js";
import { initTheme } from "./theme.js";
import {
  elements,
  showState,
  renderWeatherData,
  toggleUnit,
  updateUnitToggleUI,
} from "./ui.js";

const CACHE_KEY = "city-brief:last-result";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour TTL (Time To Live)

let activeWeatherData = null;
let lastRequest = null;
let debounceTimer = null;
let activeIndex = -1;
let currentResults = [];

/**
 * Reads weather payload from localStorage and validates TTL freshness.
 * @returns {{data: object, savedAt: number, isStale: boolean}|null}
 */
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const age = Date.now() - (parsed.savedAt || 0);
    const isStale = age > CACHE_TTL_MS;
    return { data: parsed.data, savedAt: parsed.savedAt, isStale };
  } catch {
    return null;
  }
}

/**
 * Saves current weather data payload with a timestamp to localStorage.
 * @param {object} data
 */
function writeCache(data) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data, savedAt: Date.now() }),
    );
  } catch (err) {
    console.warn("[City Brief] Failed to save weather to cache:", err);
  }
}

/**
 * Loads weather data for a given location (lat, lon, name).
 * @param {number} lat
 * @param {number} lon
 * @param {string} name
 */
async function loadWeather(lat, lon, name) {
  lastRequest = { lat, lon, name };
  showState("loading");

  if (!navigator.onLine) {
    return handleFailure("You're offline. Reconnect to load live weather.");
  }

  try {
    const data = await apiFetch(
      `/api/weather?lat=${lat}&lon=${lon}&name=${encodeURIComponent(name)}`,
    );
    writeCache(data);
    activeWeatherData = data;
    elements.offlineBadge.hidden = true;
    renderWeatherData(data);
  } catch (err) {
    handleFailure(err.message);
  }
}

/**
 * Handles errors by falling back to cached results if available, or showing error state.
 * @param {string} message
 */
function handleFailure(message) {
  const cached = readCache();
  if (cached) {
    activeWeatherData = cached.data;
    renderWeatherData(cached.data);
    elements.offlineBadge.hidden = false;
    elements.offlineBadge.textContent = cached.isStale
      ? "You're offline — showing stale cached forecast"
      : "You're offline — showing cached forecast";
    return;
  }
  elements.errorMessage.textContent =
    message || "Can't reach the weather service right now.";
  showState("error");
}

// ---------------------------------------------------------------------
// Autocomplete & Search Dropdown Logic
// ---------------------------------------------------------------------
const searchContainer = document.querySelector(".search");

function closeSuggestions() {
  elements.suggestionsEl.hidden = true;
  elements.suggestionsEl.innerHTML = "";
  activeIndex = -1;
  if (searchContainer) searchContainer.setAttribute("aria-expanded", "false");
}

function renderSuggestions(results) {
  currentResults = results;
  if (!results.length) {
    closeSuggestions();
    return;
  }
  elements.suggestionsEl.innerHTML = results
    .map(
      (r, i) => `
      <li role="option" id="opt-${i}" data-index="${i}" aria-selected="false">
        <span>${r.name}</span>
        <span class="place-region">${[r.admin1, r.country].filter(Boolean).join(", ")}</span>
      </li>
    `,
    )
    .join("");
  elements.suggestionsEl.hidden = false;
  if (searchContainer) searchContainer.setAttribute("aria-expanded", "true");
}

function selectResult(place) {
  if (!place) return;
  elements.searchInput.value = place.name;
  closeSuggestions();
  loadWeather(place.lat, place.lon, place.name);
}

function setupSearchListeners() {
  if (!elements.searchInput) return;

  elements.searchInput.addEventListener("input", () => {
    const q = elements.searchInput.value.trim();
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
        closeSuggestions();
      }
    }, 300);
  });

  elements.suggestionsEl.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    selectResult(currentResults[Number(li.dataset.index)]);
  });

  elements.searchInput.addEventListener("keydown", (e) => {
    if (elements.suggestionsEl.hidden) return;
    const items = [...elements.suggestionsEl.children];
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
}

// ---------------------------------------------------------------------
// Geolocation API Listener
// ---------------------------------------------------------------------
function setupGeolocationListener() {
  if (!elements.locateBtn) return;

  elements.locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      handleFailure("Location access is not supported in this browser.");
      return;
    }
    elements.locateBtn.classList.add("locating");
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
        } catch {
          // Fallback to default name if reverse lookup fails
        }

        elements.locateBtn.classList.remove("locating");
        elements.searchInput.value = "";
        loadWeather(lat, lon, placeName);
      },
      () => {
        elements.locateBtn.classList.remove("locating");
        handleFailure("Location permission was denied — try searching instead.");
      },
      { timeout: 8000 },
    );
  });
}

// ---------------------------------------------------------------------
// Unit Toggle Binding
// ---------------------------------------------------------------------
function setupUnitToggleListener() {
  if (!elements.unitToggle) return;
  updateUnitToggleUI();
  elements.unitToggle.addEventListener("click", () => {
    toggleUnit();
    if (activeWeatherData) {
      renderWeatherData(activeWeatherData);
    }
  });
}

// ---------------------------------------------------------------------
// Offline & Online Event Handling
// ---------------------------------------------------------------------
function setupNetworkListeners() {
  window.addEventListener("offline", () => {
    const cached = readCache();
    if (cached) {
      elements.offlineBadge.hidden = false;
      elements.offlineBadge.textContent = cached.isStale
        ? "You're offline — showing stale cached forecast"
        : "You're offline — showing cached forecast";
    }
  });

  window.addEventListener("online", () => {
    elements.offlineBadge.hidden = true;
    if (lastRequest) {
      loadWeather(lastRequest.lat, lastRequest.lon, lastRequest.name);
    }
  });

  if (elements.retryBtn) {
    elements.retryBtn.addEventListener("click", () => {
      if (lastRequest) {
        loadWeather(lastRequest.lat, lastRequest.lon, lastRequest.name);
      } else {
        showState("empty");
      }
    });
  }
}

// ---------------------------------------------------------------------
// Boot Initialization
// ---------------------------------------------------------------------
function init() {
  initTheme(elements.themeToggle);
  setupUnitToggleListener();
  setupSearchListeners();
  setupGeolocationListener();
  setupNetworkListeners();

  const cached = readCache();
  if (cached) {
    lastRequest = {
      lat: cached.data.location.lat,
      lon: cached.data.location.lon,
      name: cached.data.location.name,
    };
    activeWeatherData = cached.data;
    renderWeatherData(cached.data);

    if (!navigator.onLine) {
      elements.offlineBadge.hidden = false;
      elements.offlineBadge.textContent = cached.isStale
        ? "You're offline — showing stale cached forecast"
        : "You're offline — showing cached forecast";
    } else if (cached.isStale) {
      // Background refresh if cached data is older than TTL (1 hour)
      console.log("[City Brief] Cache expired (older than 1h), refreshing in background...");
      loadWeather(lastRequest.lat, lastRequest.lon, lastRequest.name);
    }
  } else {
    showState("empty");
  }
}

// Start application when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
