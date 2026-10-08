/**
 * 图片幻灯片 - 默认配置和常量
 */

/** @type {{interval: number, animation: string, duration: number, random: boolean}} */
const DEFAULT_CONFIG = Object.freeze({
  // 切换间隔（毫秒）
  interval: 5000,
  // 切换动画类型：none / fade / slide / zoom / flip
  animation: 'fade',
  // 动画时长（毫秒）
  duration: 1000,
  // 是否随机显示图片
  random: false,
});

/** 支持的图片扩展名（小写） */
const IMAGE_EXTENSIONS = Object.freeze([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'jxl', 'heic', 'heif',
]);

/** IndexedDB 数据库配置 */
const DB_CONFIG = Object.freeze({
  name: 'image-slideshow-web',
  version: 1,
  store: 'directory-handles',
});

/** localStorage 配置存储 key */
const STORAGE_KEY_CONFIG = 'slideshow-config';

/** 支持的动画类型 */
const ANIMATION_TYPES = Object.freeze(['none', 'fade', 'slide', 'zoom', 'flip']);
