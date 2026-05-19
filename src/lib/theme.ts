/**
 * 主题管理
 *
 * 基础模式：light / dark / auto（跟随系统）
 * 特殊主题：pink / blue / gold（通过成就解锁）
 * 通过 html[data-theme] 属性切换，CSS 变量自动响应。
 * 用户选择持久化到 localStorage。
 */

export type ThemeMode = 'light' | 'dark' | 'auto' | 'pink' | 'blue' | 'gold';

/** 需要解锁的特殊主题 */
export const SPECIAL_THEMES: ThemeMode[] = ['pink', 'blue', 'gold'];

/** 特殊主题的解锁条件描述 */
export const THEME_UNLOCK_CONDITIONS: Record<string, string> = {
  pink: '从 Bangumi 导入收藏',
  blue: '追完 5 部番剧',
  gold: '???',
};

const STORAGE_KEY = 'pochan-theme';
const UNLOCKED_KEY = 'pochan-themes-unlocked';

/** 读取用户保存的主题偏好，默认 auto */
export function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isValidTheme(stored)) return stored;
  } catch {
    // localStorage 不可用时回退
  }
  return 'auto';
}

function isValidTheme(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'auto' ||
    value === 'pink' || value === 'blue' || value === 'gold';
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

/** 获取已解锁的特殊主题列表 */
export function getUnlockedThemes(): ThemeMode[] {
  try {
    const stored = localStorage.getItem(UNLOCKED_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return parsed.filter((t: unknown) => SPECIAL_THEMES.includes(t as ThemeMode)) as ThemeMode[];
    }
  } catch {
    // 静默
  }
  return [];
}

/** 解锁一个特殊主题 */
export function unlockTheme(theme: ThemeMode): void {
  const current = getUnlockedThemes();
  if (current.includes(theme)) return;
  current.push(theme);
  try {
    localStorage.setItem(UNLOCKED_KEY, JSON.stringify(current));
  } catch {
    // 静默
  }
}

/** 检查并解锁满足条件的主题，返回新解锁的主题列表 */
export function checkAndUnlockThemes(completedCount: number, _totalWatchedEpisodes: number): ThemeMode[] {
  const newlyUnlocked: ThemeMode[] = [];
  const current = getUnlockedThemes();

  // 蓝色：追完 5 部
  if (!current.includes('blue') && completedCount >= 5) {
    unlockTheme('blue');
    newlyUnlocked.push('blue');
  }

  // 金色：暂不可解锁（未来开放）

  return newlyUnlocked;
}

/** 手动解锁粉色主题（从 Bangumi 导入时调用） */
export function unlockPinkTheme(): boolean {
  const current = getUnlockedThemes();
  if (current.includes('pink')) return false;
  unlockTheme('pink');
  return true;
}
