(function () {
  "use strict";

  var DB_NAME = "desktop-clock-assets";
  var STORE_NAME = "images";
  var BACKGROUND_KEY = "background";
  var activeUrl = "";

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () { request.result.createObjectStore(STORE_NAME); };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  async function useStore(mode, action) {
    var database = await openDatabase();
    return new Promise(function (resolve, reject) {
      var transaction = database.transaction(STORE_NAME, mode);
      var request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
      transaction.oncomplete = function () { database.close(); };
    });
  }

  function save(file) {
    return useStore("readwrite", function (store) { return store.put(file, BACKGROUND_KEY); });
  }

  function remove() {
    clearActiveUrl();
    return useStore("readwrite", function (store) { return store.delete(BACKGROUND_KEY); });
  }

  function getBlob() {
    return useStore("readonly", function (store) { return store.get(BACKGROUND_KEY); });
  }

  function clearActiveUrl() {
    if (activeUrl) URL.revokeObjectURL(activeUrl);
    activeUrl = "";
  }

  async function getUrl() {
    var blob = await getBlob();
    clearActiveUrl();
    if (!blob) return "";
    activeUrl = URL.createObjectURL(blob);
    return activeUrl;
  }

  function setEffects(target, settings) {
    target.style.setProperty("--background-blur", settings.backgroundBlur + "px");
    target.style.setProperty("--background-brightness", settings.backgroundBrightness + "%");
  }

  async function apply(settings) {
    var root = document.documentElement;
    setEffects(root, settings);
    if (!settings.backgroundEnabled) {
      root.classList.remove("has-custom-background");
      root.style.removeProperty("--background-image");
      return false;
    }

    try {
      var url = await getUrl();
      root.classList.toggle("has-custom-background", Boolean(url));
      if (url) root.style.setProperty("--background-image", 'url("' + url + '")');
      return Boolean(url);
    } catch (error) {
      root.classList.remove("has-custom-background");
      return false;
    }
  }

  window.DesktopClockBackground = {
    apply: apply,
    getUrl: getUrl,
    remove: remove,
    save: save,
    setEffects: setEffects
  };
}());
