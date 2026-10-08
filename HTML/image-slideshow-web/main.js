/**
 * 图片幻灯片 - 主逻辑
 *
 * 关键设计：
 *   - 两张 .slide 重叠，通过 .active 类切换显示，CSS 处理动画
 *   - 持久化：DirectoryHandle 存到 IndexedDB，普通配置存到 localStorage
 *   - 动画时长通过 --anim-duration CSS 变量控制，slide 动画方向由 --enter-from / --exit-to 控制
 *
 * 浏览器要求：基于 Chromium 的浏览器，且页面运行在 HTTPS 或 localhost 下。
 */

(function () {
  'use strict';

  // ============================================================
  // DOM 引用
  // ============================================================
  const $ = (id) => document.getElementById(id);

  const stage = $('stage');
  const slideshow = $('slideshow');
  const slideA = $('slideA');
  const slideB = $('slideB');
  const emptyHint = $('emptyHint');
  const loadingHint = $('loadingHint');
  const directoryListEl = $('directoryList');
  const settingsModal = $('settingsModal');

  // ============================================================
  // 全局状态
  // ============================================================
  /**
   * 应用状态对象
   * @type {{
   *   config: {interval: number, animation: string, duration: number, random: boolean},
   *   directories: Array<{handle: FileSystemDirectoryHandle, name: string, status: string, imageCount: number}>,
   *   images: Array<{url: string, name: string, size: number}>,
   *   currentIndex: number,
   *   isPlaying: boolean,
   *   timerId: number|null,
   *   activeSlide: 'A' | 'B'
   * }}
   */
  const state = {
    config: { ...DEFAULT_CONFIG },
    directories: [],
    images: [],
    currentIndex: -1,
    isPlaying: true,
    timerId: null,
    activeSlide: 'A',
  };

  // ============================================================
  // IndexedDB：用于存储 DirectoryHandle
  // DirectoryHandle 不能被序列化到 localStorage，必须放入 IndexedDB
  // ============================================================
  /** @type {Promise<IDBDatabase> | null} */
  let dbPromise = null;

  /**
   * 打开（首次访问时自动创建）IndexedDB 数据库。
   * @returns {Promise<IDBDatabase>}
   */
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_CONFIG.name, DB_CONFIG.version);
      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(DB_CONFIG.store)) {
          db.createObjectStore(DB_CONFIG.store, {
            keyPath: 'id',
            autoIncrement: true,
          });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  /**
   * 把当前所有目录句柄覆盖保存到 IndexedDB。
   * @returns {Promise<void>}
   */
  async function persistHandles() {
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_CONFIG.store, 'readwrite');
        const store = tx.objectStore(DB_CONFIG.store);
        store.clear();
        state.directories.forEach((d) => store.add({ handle: d.handle }));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('保存目录句柄失败：', e);
    }
  }

  /**
   * 从 IndexedDB 恢复 DirectoryHandle 列表。
   * @returns {Promise<FileSystemDirectoryHandle[]>}
   */
  async function loadHandles() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_CONFIG.store, 'readonly');
      const store = tx.objectStore(DB_CONFIG.store);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result.map((r) => r.handle));
      req.onerror = () => reject(req.error);
    });
  }

  // ============================================================
  // 普通配置持久化（localStorage）
  // ============================================================
  /** 把当前 state.config 写入 localStorage。 */
  function saveConfig() {
    try {
      localStorage.setItem(
        STORAGE_KEY_CONFIG,
        JSON.stringify(state.config),
      );
    } catch (e) {
      console.warn('保存配置失败：', e);
    }
  }

  /** 启动时从 localStorage 读取配置。 */
  function loadConfig() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      // 只保留已知的合法字段，避免被异常数据污染
      state.config = {
        interval: clampInt(
          parsed.interval,
          DEFAULT_CONFIG.interval,
          500,
          30000,
        ),
        animation: ANIMATION_TYPES.includes(parsed.animation)
          ? parsed.animation
          : DEFAULT_CONFIG.animation,
        duration: clampInt(parsed.duration, DEFAULT_CONFIG.duration, 0, 3000),
        random: Boolean(parsed.random),
      };
    } catch (e) {
      console.warn('加载配置失败：', e);
    }
  }

  /** @param {*} v @param {number} fallback @param {number} min @param {number} max */
  function clampInt(v, fallback, min, max) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  // ============================================================
  // File System Access API
  // ============================================================
  /**
   * 确保对某个 DirectoryHandle 拥有读权限。
   * 首次选择目录时会直接被浏览器授权；之后重新打开页面需要重新请求权限。
   * @param {FileSystemDirectoryHandle} handle
   * @returns {Promise<'granted' | 'prompt' | 'denied'>}
   */
  async function ensurePermission(handle) {
    if (!handle || typeof handle.queryPermission !== 'function') {
      return 'granted';
    }
    const opts = { mode: 'read' };
    try {
      const cur = await handle.queryPermission(opts);
      if (cur === 'granted') return 'granted';
      return await handle.requestPermission(opts);
    } catch (e) {
      console.warn('请求权限失败：', e);
      return 'denied';
    }
  }

  /**
   * 递归读取目录中的图片到 out 数组。
   * 会跳过以 "." 开头的隐藏目录。
   * @param {FileSystemDirectoryHandle} handle
   * @param {Array<{url: string, name: string, size: number}>} out
   */
  async function readDirectory(handle, out) {
    // entries() 在某些 Chromium 版本下更兼容；这里用异步迭代器
    for await (const entry of handle.values()) {
      try {
        if (entry.kind === 'file') {
          const lower = entry.name.toLowerCase();
          if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith('.' + ext))) {
            const file = await entry.getFile();
            out.push({
              url: URL.createObjectURL(file),
              name: entry.name,
              size: file.size,
            });
          }
        } else if (entry.kind === 'directory') {
          // 跳过隐藏目录，避免读取大量无用文件
          if (entry.name && !entry.name.startsWith('.')) {
            await readDirectory(entry, out);
          }
        }
      } catch (e) {
        // 单个文件/子目录失败不影响整体
        console.warn('读取条目失败：', entry.name, e);
      }
    }
  }

  // ============================================================
  // 图片加载入口
  // ============================================================
  /**
   * 读取所有已添加目录中的图片，刷新 state.images 并触发首张显示。
   */
  async function loadAllImages() {
    // 加载期间隐藏空状态提示，避免与加载提示重叠
    emptyHint.hidden = true;
    showLoading(true);

    // 释放旧的 blob URL，避免内存泄漏
    state.images.forEach((img) => img.url && URL.revokeObjectURL(img.url));
    state.images = [];

    const allImages = [];

    for (const dir of state.directories) {
      const perm = await ensurePermission(dir.handle);
      if (perm !== 'granted') {
        dir.status = 'denied';
        dir.imageCount = 0;
        continue;
      }
      try {
        const list = [];
        await readDirectory(dir.handle, list);
        dir.imageCount = list.length;
        dir.status = 'ok';
        allImages.push(...list);
      } catch (e) {
        console.error('读取目录失败：', dir.name, e);
        dir.status = 'error';
        dir.imageCount = 0;
      }
    }

    state.images = allImages;
    state.currentIndex = -1;
    state.activeSlide = 'A';
    slideA.classList.remove('active');
    slideB.classList.remove('active');
    slideA.style.backgroundImage = '';
    slideB.style.backgroundImage = '';

    showLoading(false);
    renderDirectoryList();

    if (state.images.length > 0) {
      nextImage();
    } else {
      emptyHint.hidden = false;
      stopTimer();
    }
  }

  // ============================================================
  // 幻灯片显示
  // ============================================================
  /**
   * 在两张 slide 中切换显示指定索引的图片。
   * - 先把 nextSlide 用 .entering 类临时定位到进入位置（无过渡）
   * - 强制 reflow 后清除 .entering 并切换 .active，让 CSS 接管过渡
   * @param {number} index
   */
  function showImage(index) {
    if (state.images.length === 0) return;
    const url = state.images[index].url;
    const currentSlide = state.activeSlide === 'A' ? slideA : slideB;
    const nextSlide = state.activeSlide === 'A' ? slideB : slideA;

    nextSlide.style.backgroundImage = `url("${url}")`;

    // slide 动画方向交替（A→B 时下一张从右进，B→A 时从左进）
    const dir = state.activeSlide === 'A' ? 1 : -1;
    slideshow.style.setProperty('--enter-from', `${dir * 100}%`);
    slideshow.style.setProperty('--exit-to', `${-dir * 100}%`);

    // 把下一张临时定位到"进入位置"，并关掉过渡
    nextSlide.classList.remove('active');
    nextSlide.classList.add('entering');

    // 强制 reflow，让 .entering 的样式生效
    void nextSlide.offsetWidth;

    // 启动过渡到 active 位置
    nextSlide.classList.remove('entering');
    nextSlide.classList.add('active');
    currentSlide.classList.remove('active');

    state.currentIndex = index;
    state.activeSlide = state.activeSlide === 'A' ? 'B' : 'A';
  }

  /** 切换到下一张（根据 config.random 决定顺序）。 */
  function nextImage() {
    if (state.images.length === 0) return;
    let next;
    if (state.config.random) {
      // 避免连续显示同一张
      do {
        next = Math.floor(Math.random() * state.images.length);
      } while (
        state.images.length > 1 &&
        next === state.currentIndex
      );
    } else {
      if (state.currentIndex === -1) {
        next = 0;
      } else {
        next = (state.currentIndex + 1) % state.images.length;
      }
    }
    showImage(next);
  }

  /** 切换到上一张。 */
  function prevImage() {
    if (state.images.length === 0) return;
    const prev = (state.currentIndex - 1 + state.images.length) % state.images.length;
    showImage(prev);
  }

  // ============================================================
  // 播放控制
  // ============================================================
  /** 启动自动切换定时器（如果条件允许）。 */
  function startTimer() {
    stopTimer();
    if (!state.isPlaying || state.images.length === 0) return;
    const interval = Math.max(state.config.interval, state.config.duration + 100);
    state.timerId = setInterval(nextImage, interval);
  }

  /** 停止自动切换定时器。 */
  function stopTimer() {
    if (state.timerId !== null) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  /** 切换播放/暂停。 */
  function togglePlay() {
    state.isPlaying = !state.isPlaying;
    $('iconPlayPause').textContent = state.isPlaying ? '⏸' : '▶';
    if (state.isPlaying) {
      startTimer();
    } else {
      stopTimer();
    }
  }

  // ============================================================
  // 全屏
  // ============================================================
  /** 切换全屏状态。 */
  function toggleFullscreen() {
    const el = stage;
    if (!document.fullscreenElement) {
      const fn =
        el.requestFullscreen ||
        el.webkitRequestFullscreen ||
        el.msRequestFullscreen;
      if (fn) fn.call(el);
    } else {
      const fn =
        document.exitFullscreen ||
        document.webkitExitFullscreen ||
        document.msExitFullscreen;
      if (fn) fn.call(document);
    }
  }

  // ============================================================
  // 设置面板
  // ============================================================
  /** 把 state.config 同步到表单控件。 */
  function syncSettingsForm() {
    $('inputInterval').value = state.config.interval;
    $('inputIntervalNum').value = state.config.interval;
    $('selectAnimation').value = state.config.animation;
    $('inputDuration').value = state.config.duration;
    $('inputDurationNum').value = state.config.duration;
    $('inputRandom').checked = state.config.random;
  }

  /** 从表单控件读取最新值写入 state.config。 */
  function collectConfig() {
    state.config.interval = clampInt(
      $('inputIntervalNum').value,
      DEFAULT_CONFIG.interval,
      500,
      30000,
    );
    state.config.animation = ANIMATION_TYPES.includes(
      $('selectAnimation').value,
    )
      ? $('selectAnimation').value
      : DEFAULT_CONFIG.animation;
    state.config.duration = clampInt(
      $('inputDurationNum').value,
      DEFAULT_CONFIG.duration,
      0,
      3000,
    );
    state.config.random = $('inputRandom').checked;
  }

  /** 应用 config 到 UI（动画类、CSS 变量）和计时器。 */
  function applyConfig() {
    slideshow.style.setProperty(
      '--anim-duration',
      state.config.duration + 'ms',
    );
    slideshow.className = 'slideshow anim-' + state.config.animation;
    // 配置变化后重启定时器（如果当前在播放）
    if (state.isPlaying) startTimer();
  }

  /** 打开设置面板。 */
  function openSettings() {
    syncSettingsForm();
    renderDirectoryList();
    settingsModal.hidden = false;
  }

  /** 关闭设置面板。 */
  function closeSettings() {
    settingsModal.hidden = true;
  }

  // ============================================================
  // 目录列表渲染
  // ============================================================

  /** @param {string} s */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) =>
      (
        {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }
      )[ch],
    );
  }

  /**
   * 根据 dir.status 给出简短显示文字。
   * @param {{status: string, imageCount: number}} dir
   */
  function getStatusText(dir) {
    switch (dir.status) {
      case 'ok':
        return `${dir.imageCount} 张图片`;
      case 'denied':
        return '未授权（可点击右侧按钮重新请求）';
      case 'error':
        return '读取失败';
      case 'pending':
      default:
        return '等待中…';
    }
  }

  /**
   * @param {{status: string, imageCount: number}} dir
   */
  function getStatusBadge(dir) {
    const meta = {
      ok: { cls: 'ok', text: '✓', title: '已加载' },
      denied: { cls: 'warn', text: '⚠', title: '需要授权' },
      error: { cls: 'err', text: '✕', title: '读取失败' },
      pending: { cls: 'pending', text: '…', title: '等待' },
    }[dir.status] || { cls: '', text: '', title: '' };
    return `<span class="directory-status ${meta.cls}" title="${meta.title}">${meta.text}</span>`;
  }

  /** 重新渲染设置面板中的目录列表。 */
  function renderDirectoryList() {
    directoryListEl.innerHTML = '';
    if (state.directories.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty-list';
      li.textContent = '还没有添加任何目录。';
      directoryListEl.appendChild(li);
      return;
    }
    state.directories.forEach((dir, idx) => {
      const li = document.createElement('li');
      li.className = 'directory-item';
      li.innerHTML = `
        <div class="directory-info">
          <div class="directory-name" title="${escapeHtml(dir.name)}">${escapeHtml(dir.name)}</div>
          <div class="directory-meta">${escapeHtml(getStatusText(dir))}</div>
        </div>
        ${getStatusBadge(dir)}
        <div class="directory-actions">
          <button class="icon-btn" data-action="retry" data-idx="${idx}" title="重新请求授权 / 重新读取" aria-label="重新读取">↻</button>
          <button class="icon-btn danger" data-action="remove" data-idx="${idx}" title="移除" aria-label="移除">×</button>
        </div>
      `;
      directoryListEl.appendChild(li);
    });

    // 事件委托
    directoryListEl.querySelectorAll('.icon-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        const action = btn.dataset.action;
        if (action === 'remove') removeDirectory(idx);
        else if (action === 'retry') retryDirectory(idx);
      });
    });
  }

  // ============================================================
  // 目录操作
  // ============================================================
  /**
   * 通过 showDirectoryPicker 选择一个新目录并加入。
   */
  async function addDirectory() {
    if (typeof window.showDirectoryPicker !== 'function') {
      alert(
        '您的浏览器不支持 File System Access API。请使用基于 Chromium 内核的浏览器（如 Chrome、Edge、Opera）。',
      );
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({
        id: 'slideshow-dir',
        mode: 'read',
      });

      // 基于指针比较去重
      if (state.directories.some((d) => d.handle === handle)) {
        alert('该目录已经添加。');
        return;
      }

      state.directories.push({
        handle,
        name: handle.name,
        status: 'pending',
        imageCount: 0,
      });
      await persistHandles();
      renderDirectoryList();
      await loadAllImages();
    } catch (e) {
      // 用户取消选择
      if (e && e.name === 'AbortError') return;
      console.error(e);
      alert('添加目录失败：' + (e && e.message ? e.message : e));
    }
  }

  /**
   * 重新请求某个目录的权限并读取其图片。
   * 通常在恢复自 IndexedDB 的句柄，需要再次授权时使用。
   * @param {number} idx
   */
  async function retryDirectory(idx) {
    const dir = state.directories[idx];
    if (!dir) return;
    const perm = await ensurePermission(dir.handle);
    if (perm !== 'granted') {
      alert('授权失败，仍无法访问该目录。');
      renderDirectoryList();
      return;
    }
    await loadAllImages();
  }

  /**
   * 移除某个目录（同时更新 IndexedDB 与已加载的图片）。
   * @param {number} idx
   */
  async function removeDirectory(idx) {
    if (!confirm('确定要移除这个目录吗？')) return;
    state.directories.splice(idx, 1);
    await persistHandles();
    await loadAllImages();
    renderDirectoryList();
  }

  // ============================================================
  // 表单双向绑定（range 与 number 互相同步）
  // ============================================================
  /**
   * @param {string} rangeId
   * @param {string} numId
   */
  function bindRange(rangeId, numId) {
    const range = $(rangeId);
    const num = $(numId);
    range.addEventListener('input', () => {
      num.value = range.value;
    });
    num.addEventListener('input', () => {
      const min = parseInt(num.min, 10);
      const max = parseInt(num.max, 10);
      const v = clamp(parseInt(num.value, 10), min, max);
      range.value = Number.isFinite(v) ? v : min;
    });
    num.addEventListener('change', () => {
      const min = parseInt(num.min, 10);
      const max = parseInt(num.max, 10);
      const v = clamp(parseInt(num.value, 10), min, max);
      const finalV = Number.isFinite(v) ? v : min;
      num.value = finalV;
      range.value = finalV;
    });
  }

  /** @param {number} v @param {number} min @param {number} max */
  function clamp(v, min, max) {
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.min(max, v));
  }

  // ============================================================
  // 键盘快捷键
  // ============================================================
  /** @param {KeyboardEvent} e */
  function handleKey(e) {
    // 设置面板打开时只处理 Esc
    if (!settingsModal.hidden) {
      if (e.key === 'Escape') closeSettings();
      return;
    }
    // 输入框中的按键不响应
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.key) {
      case ' ':
      case 'Spacebar':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        prevImage();
        break;
      case 'ArrowRight':
        nextImage();
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      case 'Escape':
        if (document.fullscreenElement) toggleFullscreen();
        break;
    }
  }

  // ============================================================
  // 加载状态提示
  // ============================================================
  /** @param {boolean} show */
  function showLoading(show) {
    loadingHint.hidden = !show;
  }

  // ============================================================
  // 事件绑定
  // ============================================================
  function bindEvents() {
    // 控制按钮
    $('btnPlayPause').addEventListener('click', togglePlay);
    $('btnPrev').addEventListener('click', prevImage);
    $('btnNext').addEventListener('click', nextImage);
    $('btnFullscreen').addEventListener('click', toggleFullscreen);
    $('btnSettings').addEventListener('click', openSettings);

    // 设置面板
    $('btnCloseSettings').addEventListener('click', closeSettings);
    $('btnAddDirectory').addEventListener('click', addDirectory);
    $('modalBackdrop').addEventListener('click', closeSettings);
    $('btnReloadImages').addEventListener('click', async () => {
      await loadAllImages();
    });
    $('btnSaveSettings').addEventListener('click', () => {
      collectConfig();
      saveConfig();
      applyConfig();
      closeSettings();
    });

    // 表单控件双向绑定
    bindRange('inputInterval', 'inputIntervalNum');
    bindRange('inputDuration', 'inputDurationNum');

    // 键盘快捷键
    document.addEventListener('keydown', handleKey);

    // 全屏变化时无需特别处理，但保留扩展点
    document.addEventListener('fullscreenchange', () => {
      // 某些全屏实现中需要重新计算尺寸
      // 这里留给浏览器自动处理
    });
  }

  // ============================================================
  // 启动
  // ============================================================
  async function init() {
    loadConfig();

    // 尝试从 IndexedDB 恢复 DirectoryHandle
    try {
      const handles = await loadHandles();
      if (handles && handles.length > 0) {
        state.directories = handles.map((h) => ({
          handle: h,
          name: h.name || '(未命名目录)',
          status: 'pending',
          imageCount: 0,
        }));
      }
    } catch (e) {
      console.warn('加载目录句柄失败：', e);
    }

    bindEvents();
    applyConfig();

    // 加载图片（从 IndexedDB 恢复的目录可能需要用户授权）
    if (state.directories.length > 0) {
      await loadAllImages();
    } else {
      emptyHint.hidden = false;
    }

    startTimer();
  }

  init();
})();
