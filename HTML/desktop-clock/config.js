(function () {
  "use strict";

  var STORAGE_KEY = "desktop-clock-settings-v1";
  var defaults = {
    hourCycle: "24",
    showSeconds: true,
    showDate: true,
    theme: "dark",
    themeColors: {
      dark: { primary: "#b9f46a", secondary: "#ff9b74" },
      light: { primary: "#547d1c", secondary: "#c34f2d" }
    },
    backgroundColorEnabled: false,
    backgroundColors: {
      dark: "#101311",
      light: "#f3f4ef"
    },
    backgroundEnabled: false,
    backgroundBlur: 0,
    backgroundBrightness: 65,
    soundEnabled: true,
    keepAwake: false
  };

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      var settings = Object.assign({}, defaults, saved);
      settings.themeColors = Object.assign({}, defaults.themeColors, saved.themeColors || {});
      ["dark", "light"].forEach(function (mode) {
        settings.themeColors[mode] = Object.assign({}, defaults.themeColors[mode], settings.themeColors[mode] || {});
      });
      settings.backgroundColors = Object.assign({}, defaults.backgroundColors, saved.backgroundColors || {});
      if (saved.accentColor && !saved.themeColors) {
        settings.themeColors.dark.primary = saved.accentColor;
        settings.themeColors.light.primary = saved.accentColor;
      }
      if (saved.backgroundColor && !saved.backgroundColors) {
        settings.backgroundColors.dark = saved.backgroundColor;
        settings.backgroundColors.light = saved.backgroundColor;
      }
      return settings;
    } catch (error) {
      return Object.assign({}, defaults);
    }
  }

  function save(settings) {
    var next = Object.assign({}, defaults, settings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("clocksettingschange", { detail: next }));
    return next;
  }

  function normalizeColor(color, fallback) {
    return /^#[0-9a-f]{6}$/i.test(color || "") ? color : fallback;
  }

  function getContrastColor(hex) {
    var red = parseInt(hex.slice(1, 3), 16);
    var green = parseInt(hex.slice(3, 5), 16);
    var blue = parseInt(hex.slice(5, 7), 16);
    return red * 0.299 + green * 0.587 + blue * 0.114 > 156 ? "#17200d" : "#ffffff";
  }

  function getEffectiveTheme(theme) {
    return theme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : theme === "light" ? "light" : "dark";
  }

  function applyTheme(theme, themeColors) {
    var activeTheme = getEffectiveTheme(theme || load().theme);
    var colors = (themeColors || load().themeColors)[activeTheme];
    var primary = normalizeColor(colors.primary, defaults.themeColors[activeTheme].primary);
    var secondary = normalizeColor(colors.secondary, defaults.themeColors[activeTheme].secondary);
    document.documentElement.dataset.theme = theme || load().theme;
    document.documentElement.style.setProperty("--accent", primary);
    document.documentElement.style.setProperty("--accent-text", getContrastColor(primary));
    document.documentElement.style.setProperty("--warm", secondary);
  }

  function applyBackgroundColor(enabled, backgroundColors, theme) {
    var root = document.documentElement;
    if (!enabled) {
      root.style.removeProperty("--bg");
      return;
    }
    var activeTheme = getEffectiveTheme(theme || load().theme);
    var colors = backgroundColors || load().backgroundColors;
    root.style.setProperty("--bg", normalizeColor(colors[activeTheme], defaults.backgroundColors[activeTheme]));
  }

  window.DesktopClock = {
    defaults: defaults,
    loadSettings: load,
    saveSettings: save,
    applyTheme: applyTheme,
    applyBackgroundColor: applyBackgroundColor,
    getEffectiveTheme: getEffectiveTheme
  };

  var initialSettings = load();
  applyTheme(initialSettings.theme, initialSettings.themeColors);
  applyBackgroundColor(initialSettings.backgroundColorEnabled, initialSettings.backgroundColors, initialSettings.theme);
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", function () {
    var settings = load();
    if (settings.theme === "system") {
      applyTheme(settings.theme, settings.themeColors);
      applyBackgroundColor(settings.backgroundColorEnabled, settings.backgroundColors, settings.theme);
    }
  });
}());
