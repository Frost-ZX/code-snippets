(function () {
  "use strict";

  var config = window.DesktopClock;
  var background = window.DesktopClockBackground;
  var settings = config.loadSettings();
  var activeMode = "clock";
  var wakeLock = null;

  var clockTime = document.getElementById("clock-time");
  var dateLine = document.getElementById("date-line");
  var period = document.getElementById("period");
  var timezone = document.getElementById("timezone");
  var monthIndex = document.getElementById("month-index");
  var dayIndex = document.getElementById("day-index");
  var dayProgressBar = document.getElementById("day-progress-bar");
  var dayProgressValue = document.getElementById("day-progress-value");
  var statusText = document.getElementById("status-text");
  var toast = document.getElementById("toast");

  var stopwatch = { running: false, elapsed: 0, startedAt: 0, frame: 0 };
  var stopwatchDisplay = document.getElementById("stopwatch-display");
  var stopwatchToggle = document.getElementById("stopwatch-toggle");
  var stopwatchReset = document.getElementById("stopwatch-reset");

  var timer = { running: false, duration: 0, remaining: 0, endsAt: 0, frame: 0 };
  var timerDisplay = document.getElementById("timer-display");
  var timerEditor = document.getElementById("timer-editor");
  var timerToggle = document.getElementById("timer-toggle");
  var timerReset = document.getElementById("timer-reset");
  var quickTimes = document.getElementById("quick-times");
  var timerInputs = ["timer-hours", "timer-minutes", "timer-seconds"].map(function (id) {
    return document.getElementById(id);
  });

  function pad(number, length) {
    return String(number).padStart(length || 2, "0");
  }

  function renderClock() {
    var now = new Date();
    var hours = now.getHours();
    var displayHours = hours;
    var periodText = "";

    if (settings.hourCycle === "12") {
      periodText = hours >= 12 ? "下午" : "上午";
      displayHours = hours % 12 || 12;
    }

    var secondsMarkup = settings.showSeconds ? '<span class="seconds">:' + pad(now.getSeconds()) + "</span>" : "";
    clockTime.innerHTML = pad(displayHours) + ":" + pad(now.getMinutes()) + secondsMarkup;
    clockTime.dateTime = now.toISOString();
    period.textContent = periodText;
    period.hidden = !periodText;
    dateLine.hidden = !settings.showDate;
    dateLine.textContent = new Intl.DateTimeFormat("zh-CN", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    }).format(now);
    timezone.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || "本地时间";
    monthIndex.textContent = new Intl.DateTimeFormat("en", { month: "short" }).format(now).toUpperCase();
    dayIndex.textContent = pad(now.getDate());
    var elapsedToday = hours * 3600 + now.getMinutes() * 60 + now.getSeconds();
    var dayPercent = elapsedToday / 86400 * 100;
    dayProgressBar.style.height = dayPercent + "%";
    dayProgressValue.textContent = Math.floor(dayPercent) + "%";
  }

  function formatCounter(milliseconds, showCentiseconds) {
    var totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor(totalSeconds % 3600 / 60);
    var seconds = totalSeconds % 60;
    var main = hours > 0 ? pad(hours) + ":" + pad(minutes) + ":" + pad(seconds) : pad(minutes) + ":" + pad(seconds);
    return showCentiseconds ? main + "<span>." + pad(Math.floor(milliseconds % 1000 / 10)) + "</span>" : main;
  }

  function updateStopwatch() {
    if (stopwatch.running) stopwatch.elapsed = performance.now() - stopwatch.startedAt;
    stopwatchDisplay.innerHTML = formatCounter(stopwatch.elapsed, true);
    if (stopwatch.running) stopwatch.frame = requestAnimationFrame(updateStopwatch);
  }

  function toggleStopwatch() {
    stopwatch.running = !stopwatch.running;
    if (stopwatch.running) {
      stopwatch.startedAt = performance.now() - stopwatch.elapsed;
      stopwatchToggle.textContent = "暂停";
      stopwatchReset.disabled = true;
      statusText.textContent = "秒表计时中";
      updateStopwatch();
    } else {
      cancelAnimationFrame(stopwatch.frame);
      stopwatchToggle.textContent = "继续";
      stopwatchReset.disabled = false;
      statusText.textContent = "秒表已暂停";
    }
  }

  function resetStopwatch() {
    stopwatch.elapsed = 0;
    stopwatchToggle.textContent = "开始";
    stopwatchReset.disabled = true;
    stopwatchDisplay.innerHTML = "00:00<span>.00</span>";
    statusText.textContent = "准备就绪";
  }

  function readTimerDuration() {
    var values = timerInputs.map(function (input) {
      var max = Number(input.max);
      var value = Math.max(0, Math.min(max, Number(input.value) || 0));
      input.value = value;
      return value;
    });
    return (values[0] * 3600 + values[1] * 60 + values[2]) * 1000;
  }

  function renderTimer() {
    timerDisplay.innerHTML = formatCounter(timer.remaining, false);
  }

  function updateTimer() {
    if (!timer.running) return;
    timer.remaining = Math.max(0, timer.endsAt - Date.now());
    renderTimer();
    if (timer.remaining <= 0) {
      finishTimer();
      return;
    }
    timer.frame = requestAnimationFrame(updateTimer);
  }

  function toggleTimer() {
    if (!timer.running && timer.remaining <= 0) {
      timer.duration = readTimerDuration();
      timer.remaining = timer.duration;
      if (!timer.duration) {
        showToast("请先设置倒计时时长");
        return;
      }
      timerEditor.hidden = true;
      quickTimes.hidden = true;
      timerDisplay.hidden = false;
    }

    timer.running = !timer.running;
    if (timer.running) {
      timer.endsAt = Date.now() + timer.remaining;
      timerToggle.textContent = "暂停";
      timerReset.disabled = true;
      statusText.textContent = "倒计时进行中";
      requestWakeLock();
      updateTimer();
    } else {
      cancelAnimationFrame(timer.frame);
      timerToggle.textContent = "继续";
      timerReset.disabled = false;
      statusText.textContent = "倒计时已暂停";
      releaseWakeLock();
    }
  }

  function resetTimer() {
    cancelAnimationFrame(timer.frame);
    timer.running = false;
    timer.remaining = 0;
    timerToggle.textContent = "开始";
    timerReset.disabled = true;
    timerDisplay.hidden = true;
    timerEditor.hidden = false;
    quickTimes.hidden = false;
    statusText.textContent = "准备就绪";
    releaseWakeLock();
  }

  function finishTimer() {
    timer.running = false;
    timer.remaining = 0;
    timerToggle.textContent = "再次开始";
    timerReset.disabled = false;
    statusText.textContent = "倒计时已完成";
    releaseWakeLock();
    if (settings.soundEnabled) playAlarm();
    showToast("倒计时结束");
  }

  function playAlarm() {
    var AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    var context = new AudioContext();
    [0, 0.22, 0.44].forEach(function (delay) {
      var oscillator = context.createOscillator();
      var gain = context.createGain();
      oscillator.frequency.value = 740;
      gain.gain.setValueAtTime(0.001, context.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + delay + 0.15);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(context.currentTime + delay);
      oscillator.stop(context.currentTime + delay + 0.16);
    });
  }

  async function requestWakeLock() {
    if (!settings.keepAwake || !("wakeLock" in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request("screen"); } catch (error) { wakeLock = null; }
  }

  function releaseWakeLock() {
    if (wakeLock) wakeLock.release();
    wakeLock = null;
  }

  function setMode(mode) {
    activeMode = mode;
    document.querySelectorAll("[data-mode]").forEach(function (button) {
      var active = button.dataset.mode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll("[data-panel]").forEach(function (panel) {
      var active = panel.dataset.panel === mode;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    if (mode === "clock") statusText.textContent = "准备就绪";
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(showToast.timeout);
    showToast.timeout = setTimeout(function () { toast.classList.remove("is-visible"); }, 2400);
  }

  document.querySelectorAll("[data-mode]").forEach(function (button) {
    button.addEventListener("click", function () { setMode(button.dataset.mode); });
  });
  stopwatchToggle.addEventListener("click", toggleStopwatch);
  stopwatchReset.addEventListener("click", resetStopwatch);
  timerToggle.addEventListener("click", toggleTimer);
  timerReset.addEventListener("click", resetTimer);
  quickTimes.addEventListener("click", function (event) {
    var button = event.target.closest("[data-minutes]");
    if (!button) return;
    timerInputs[0].value = 0;
    timerInputs[1].value = button.dataset.minutes;
    timerInputs[2].value = 0;
    quickTimes.querySelectorAll("button").forEach(function (item) { item.classList.toggle("is-selected", item === button); });
  });

  document.getElementById("fullscreen-button").addEventListener("click", function () {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(function () { showToast("当前浏览器不支持全屏"); });
    } else document.exitFullscreen();
  });

  document.addEventListener("fullscreenchange", function () {
    var button = document.getElementById("fullscreen-button");
    button.setAttribute("aria-label", document.fullscreenElement ? "退出全屏" : "进入全屏");
    button.title = button.getAttribute("aria-label");
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && timer.running) {
      updateTimer();
      requestWakeLock();
    }
  });
  window.addEventListener("storage", function () {
    settings = config.loadSettings();
    config.applyTheme(settings.theme, settings.themeColors);
    config.applyBackgroundColor(settings.backgroundColorEnabled, settings.backgroundColors, settings.theme);
    background.apply(settings);
    renderClock();
  });

  background.apply(settings);
  renderClock();
  setInterval(renderClock, 250);
  timezone.title = new Date().toString().match(/\((.*)\)/)?.[1] || "";
}());
