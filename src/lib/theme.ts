/**
 * 主题管理
 *
 * 支持三种模式：light / dark / auto（跟随系统）
 * 通过 html[data-theme] 属性切换，CSS 变量自动响应。
 * 用户选择持久化到 localStorage。
 */

export type ThemeMode = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'pochan-theme';

/** 读取用户保存的主题偏好，默认 auto */
export function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'auto') {
      return stored;
    }
  } catch {
    // localStorage 不可用时回退
  }
  return 'auto';
}

/** 保存主题偏好 */
export function setStoredTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // 静默失败
  }
}

/** 应用主题到 DOM */
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', mode);
}

/** 初始化：读取存储并应用 */
export function initTheme(): ThemeMode {
  const mode = getStoredTheme();
  applyTheme(mode);
  return mode;
}
