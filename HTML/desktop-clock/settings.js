(function () {
  "use strict";

  var config = window.DesktopClock;
  var background = window.DesktopClockBackground;
  var form = document.getElementById("settings-form");
  var toast = document.getElementById("toast");
  var preview = document.getElementById("background-preview");
  var previewImage = document.getElementById("background-preview-image");
  var backgroundEmpty = document.getElementById("background-empty");
  var backgroundFile = document.getElementById("background-file");
  var removeBackground = document.getElementById("remove-background");
  var primaryColorInput = form.elements.primaryColor;
  var secondaryColorInput = form.elements.secondaryColor;
  var backgroundColorInput = form.elements.backgroundColor;
  var paletteMode = "dark";
  var backgroundPaletteMode = "dark";
  var settingsState = config.loadSettings();
  var backgroundPresets = {
    dark: ["#101311", "#14242a", "#211925", "#2a2017", "#18271d"],
    light: ["#f3f4ef", "#eaf2f4", "#f4edf2", "#f8f0e4", "#ebf3e8"]
  };
  var themePresets = {
    dark: [
      { name: "青柠晨光", primary: "#b9f46a", secondary: "#ff9b74" },
      { name: "冰川薄荷", primary: "#58d6c0", secondary: "#79aaff" },
      { name: "莓果夜色", primary: "#e68ac0", secondary: "#f4b36a" },
      { name: "琥珀余晖", primary: "#f3b25f", secondary: "#df755e" },
      { name: "月光蓝", primary: "#91b5ff", secondary: "#c5a5ed" }
    ],
    light: [
      { name: "林地绿", primary: "#547d1c", secondary: "#c34f2d" },
      { name: "湖岸青", primary: "#167e76", secondary: "#3777bb" },
      { name: "玫瑰红", primary: "#aa4a80", secondary: "#b46d26" },
      { name: "陶土橙", primary: "#a85d16", secondary: "#a9403d" },
      { name: "深海蓝", primary: "#3869a9", secondary: "#765aa3" }
    ]
  };

  function cloneThemeColors(colors) {
    return {
      dark: Object.assign({}, colors.dark),
      light: Object.assign({}, colors.light)
    };
  }

  function cloneBackgroundColors(colors) {
    return { dark: colors.dark, light: colors.light };
  }

  function fillForm(settings) {
    Object.keys(settings).forEach(function (key) {
      var field = form.elements[key];
      if (!field) return;
      if (field instanceof RadioNodeList) field.value = settings[key];
      else if (field.type === "checkbox") field.checked = settings[key];
      else field.value = settings[key];
    });
  }

  function readForm() {
    var themeColors = cloneThemeColors(settingsState.themeColors);
    var backgroundColors = cloneBackgroundColors(settingsState.backgroundColors);
    themeColors[paletteMode] = {
      primary: primaryColorInput.value,
      secondary: secondaryColorInput.value
    };
    backgroundColors[backgroundPaletteMode] = backgroundColorInput.value;
    return {
      hourCycle: form.elements.hourCycle.value,
      showSeconds: form.elements.showSeconds.checked,
      showDate: form.elements.showDate.checked,
      theme: form.elements.theme.value,
      themeColors: themeColors,
      backgroundColorEnabled: form.elements.backgroundColorEnabled.checked,
      backgroundColors: backgroundColors,
      backgroundEnabled: form.elements.backgroundEnabled.checked,
      backgroundBlur: Number(form.elements.backgroundBlur.value),
      backgroundBrightness: Number(form.elements.backgroundBrightness.value),
      soundEnabled: form.elements.soundEnabled.checked,
      keepAwake: form.elements.keepAwake.checked
    };
  }

  function applySettings(settings) {
    config.applyTheme(settings.theme, settings.themeColors);
    config.applyBackgroundColor(settings.backgroundColorEnabled, settings.backgroundColors, settings.theme);
  }

  function showMessage(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(showMessage.timeout);
    showMessage.timeout = setTimeout(function () { toast.classList.remove("is-visible"); }, 1400);
  }

  function updatePaletteEditor() {
    var colors = settingsState.themeColors[paletteMode];
    primaryColorInput.value = colors.primary;
    secondaryColorInput.value = colors.secondary;
    document.querySelectorAll("[data-palette]").forEach(function (tab) {
      var selected = tab.dataset.palette === paletteMode;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    document.querySelectorAll(".theme-preset").forEach(function (swatch, index) {
      var preset = themePresets[paletteMode][index];
      swatch.style.setProperty("--primary", preset.primary);
      swatch.style.setProperty("--secondary", preset.secondary);
      swatch.title = preset.name;
      swatch.setAttribute("aria-label", preset.name);
      swatch.classList.toggle("is-selected", preset.primary === colors.primary && preset.secondary === colors.secondary);
    });
  }

  function updateBackgroundColorEditor() {
    var color = settingsState.backgroundColors[backgroundPaletteMode];
    backgroundColorInput.value = color;
    document.querySelectorAll("[data-background-palette]").forEach(function (tab) {
      var selected = tab.dataset.backgroundPalette === backgroundPaletteMode;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    document.querySelectorAll(".background-swatch").forEach(function (swatch, index) {
      var preset = backgroundPresets[backgroundPaletteMode][index];
      swatch.style.setProperty("--swatch", preset);
      swatch.title = preset;
      swatch.classList.toggle("is-selected", preset.toLowerCase() === color.toLowerCase());
    });
  }

  function updateRangeLabels(settings) {
    document.getElementById("blur-value").textContent = settings.backgroundBlur + " px";
    document.getElementById("brightness-value").textContent = settings.backgroundBrightness + "%";
    background.setEffects(preview, settings);
  }

  async function loadBackgroundPreview(settings) {
    try {
      var url = await background.getUrl();
      var hasImage = Boolean(url);
      previewImage.src = url;
      previewImage.hidden = !hasImage;
      backgroundEmpty.hidden = hasImage;
      removeBackground.disabled = !hasImage;
      updateRangeLabels(settings);
    } catch (error) {
      backgroundEmpty.textContent = "无法读取背景图片";
    }
  }

  form.addEventListener("change", function (event) {
    if (event.target === backgroundFile) return;
    settingsState = config.saveSettings(readForm());
    applySettings(settingsState);
    if (event.target.name === "theme") {
      paletteMode = config.getEffectiveTheme(settingsState.theme);
      backgroundPaletteMode = paletteMode;
    }
    updatePaletteEditor();
    updateBackgroundColorEditor();
    showMessage("设置已保存");
  });

  form.addEventListener("input", function (event) {
    if (event.target.type === "range") updateRangeLabels(readForm());
    if (event.target === primaryColorInput || event.target === secondaryColorInput) {
      applySettings(readForm());
    }
    if (event.target === backgroundColorInput) {
      form.elements.backgroundColorEnabled.checked = true;
      var backgroundSettings = readForm();
      applySettings(backgroundSettings);
    }
  });

  document.querySelectorAll("[data-palette]").forEach(function (tab) {
    tab.addEventListener("click", function () {
      var pendingSettings = readForm();
      settingsState.themeColors = pendingSettings.themeColors;
      paletteMode = tab.dataset.palette;
      updatePaletteEditor();
    });
  });

  document.querySelectorAll(".theme-preset").forEach(function (swatch, index) {
    swatch.addEventListener("click", function () {
      var preset = themePresets[paletteMode][index];
      primaryColorInput.value = preset.primary;
      secondaryColorInput.value = preset.secondary;
      settingsState = config.saveSettings(readForm());
      applySettings(settingsState);
      updatePaletteEditor();
      showMessage("主题配色已更新");
    });
  });

  document.querySelectorAll("[data-background-palette]").forEach(function (tab) {
    tab.addEventListener("click", function () {
      var pendingSettings = readForm();
      settingsState.backgroundColors = pendingSettings.backgroundColors;
      backgroundPaletteMode = tab.dataset.backgroundPalette;
      updateBackgroundColorEditor();
    });
  });

  document.querySelectorAll(".background-swatch").forEach(function (swatch, index) {
    swatch.addEventListener("click", function () {
      backgroundColorInput.value = backgroundPresets[backgroundPaletteMode][index];
      form.elements.backgroundColorEnabled.checked = true;
      settingsState = config.saveSettings(readForm());
      applySettings(settingsState);
      updateBackgroundColorEditor();
      showMessage("背景颜色已更新");
    });
  });

  backgroundFile.addEventListener("change", async function () {
    var file = backgroundFile.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showMessage("请选择有效的图片文件");
      backgroundFile.value = "";
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      showMessage("图片不能超过 20 MB");
      backgroundFile.value = "";
      return;
    }
    try {
      await background.save(file);
      form.elements.backgroundEnabled.checked = true;
      settingsState = config.saveSettings(readForm());
      await loadBackgroundPreview(settingsState);
      showMessage("背景已更新");
    } catch (error) {
      showMessage("无法保存背景图片");
    }
    backgroundFile.value = "";
  });

  removeBackground.addEventListener("click", async function () {
    try {
      await background.remove();
      form.elements.backgroundEnabled.checked = false;
      settingsState = config.saveSettings(readForm());
      await loadBackgroundPreview(settingsState);
      showMessage("背景已移除");
    } catch (error) {
      showMessage("无法移除背景图片");
    }
  });

  document.getElementById("reset-settings").addEventListener("click", function () {
    settingsState = config.saveSettings(config.defaults);
    fillForm(settingsState);
    paletteMode = config.getEffectiveTheme(settingsState.theme);
    backgroundPaletteMode = paletteMode;
    applySettings(settingsState);
    updatePaletteEditor();
    updateBackgroundColorEditor();
    updateRangeLabels(settingsState);
    showMessage("设置已恢复");
  });

  fillForm(settingsState);
  paletteMode = config.getEffectiveTheme(settingsState.theme);
  backgroundPaletteMode = paletteMode;
  applySettings(settingsState);
  updatePaletteEditor();
  updateBackgroundColorEditor();
  loadBackgroundPreview(settingsState);
}());
