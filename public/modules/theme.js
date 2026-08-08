/**
 * @file theme.js
 * @description Theme Management Module for City Brief Weather App.
 * Handles switching between Weather Sky (Auto), Dark Mode, and Light Mode,
 * updating body dataset attributes, updating header action icons, and localStorage persistence.
 */

const THEME_CACHE_KEY = "city-brief:theme";

let currentTheme = localStorage.getItem(THEME_CACHE_KEY) || "auto"; // "auto", "dark", "light"

/**
 * Returns the currently active theme mode.
 * @returns {string} - "auto", "dark", or "light"
 */
export function getTheme() {
  return currentTheme;
}

/**
 * Applies the specified theme mode to the DOM and updates localStorage.
 * @param {string} theme - "auto", "dark", or "light"
 * @param {HTMLElement|null} themeToggleBtn - Header theme toggle button element
 */
export function applyTheme(theme, themeToggleBtn = document.getElementById("theme-toggle")) {
  currentTheme = theme;
  localStorage.setItem(THEME_CACHE_KEY, theme);

  const autoIcon = themeToggleBtn ? themeToggleBtn.querySelector(".theme-icon-auto") : null;
  const sunIcon = themeToggleBtn ? themeToggleBtn.querySelector(".theme-icon-sun") : null;
  const moonIcon = themeToggleBtn ? themeToggleBtn.querySelector(".theme-icon-moon") : null;

  if (autoIcon) autoIcon.toggleAttribute("hidden", theme !== "auto");
  if (sunIcon) sunIcon.toggleAttribute("hidden", theme !== "light");
  if (moonIcon) moonIcon.toggleAttribute("hidden", theme !== "dark");

  if (theme === "dark") {
    document.body.dataset.theme = "dark";
    if (themeToggleBtn) {
      themeToggleBtn.title = "Theme: Dark Mode — Click to switch to Light Mode";
      themeToggleBtn.setAttribute("aria-label", "Theme: Dark Mode. Click to switch to Light Mode");
    }
  } else if (theme === "light") {
    document.body.dataset.theme = "light";
    if (themeToggleBtn) {
      themeToggleBtn.title = "Theme: Light Mode — Click to switch to Weather Sky Mode";
      themeToggleBtn.setAttribute("aria-label", "Theme: Light Mode. Click to switch to Weather Sky Mode");
    }
  } else {
    // Auto theme: remove data-theme so weather sky gradient takes full effect
    delete document.body.dataset.theme;
    if (themeToggleBtn) {
      themeToggleBtn.title = "Theme: Weather Sky (Auto) — Click to switch to Dark Mode";
      themeToggleBtn.setAttribute("aria-label", "Theme: Weather Sky Auto Mode. Click to switch to Dark Mode");
    }
  }
}

/**
 * Cycles to the next available theme (Auto -> Dark -> Light -> Auto).
 * @param {HTMLElement|null} themeToggleBtn
 */
export function cycleTheme(themeToggleBtn = document.getElementById("theme-toggle")) {
  if (themeToggleBtn) {
    themeToggleBtn.classList.add("theme-animating");
    setTimeout(() => themeToggleBtn.classList.remove("theme-animating"), 500);
  }

  document.body.classList.add("theme-transition");
  setTimeout(() => document.body.classList.remove("theme-transition"), 600);

  if (currentTheme === "auto" || !currentTheme) {
    applyTheme("dark", themeToggleBtn);
  } else if (currentTheme === "dark") {
    applyTheme("light", themeToggleBtn);
  } else {
    applyTheme("auto", themeToggleBtn);
  }
}

/**
 * Initializes theme on page load.
 * @param {HTMLElement|null} themeToggleBtn
 */
export function initTheme(themeToggleBtn = document.getElementById("theme-toggle")) {
  applyTheme(currentTheme, themeToggleBtn);
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => cycleTheme(themeToggleBtn));
  }
}
