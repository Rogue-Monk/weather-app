(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    // AMD module support
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    // Node.js / CommonJS module support
    module.exports = factory();
  } else {
    // Browser global (root is window)
    root.WeatherUtils = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * WMO Weather Interpretation Codes (WW) mapping table.
   * Open-Meteo uses World Meteorological Organization standard weather codes.
   */
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

  /**
   * Translates a numeric WMO code into human-readable weather description and icon key.
   * @param {number} code
   * @returns {{description: string, icon: string, category: string}}
   */
  function describeWeatherCode(code) {
    return (
      WEATHER_CODES[code] || {
        description: "Unknown",
        icon: "unknown",
        category: "cloudy",
      }
    );
  }

  /**
   * Generates a helpful clothing recommendation based on temperature (°C) and condition category.
   * @param {number} tempC
   * @param {string} category
   * @returns {string}
   */
  function clothingSuggestion(tempC, category) {
    if (category === "storm") return "Stay in if you can — thunderstorm conditions";
    if (category === "snow") return "Bundle up, snow is falling";
    if (category === "rain") return "Grab an umbrella, it's wet out there";
    if (tempC < 5) return "Heavy coat weather";
    if (tempC < 15) return "A jacket will do";
    if (tempC < 25) return "Light layers are enough";
    return "It's shorts weather";
  }

  /**
   * Parses an ISO date string (YYYY-MM-DD) into a local Date object.
   * Avoids timezone offset bugs when converting dates to local weekday strings.
   * @param {string} dateStr - Date string in "YYYY-MM-DD" format
   * @returns {Date}
   */
  function parseLocalDate(dateStr) {
    if (!dateStr) return new Date();
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // Months are 0-indexed in JS
      const day = parseInt(parts[2], 10);
      return new Date(year, month, day);
    }
    return new Date(dateStr);
  }

  return {
    WEATHER_CODES,
    describeWeatherCode,
    clothingSuggestion,
    parseLocalDate,
  };
});
