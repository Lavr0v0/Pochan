/**
 * 通知提醒系统
 *
 * 功能：检查今天有哪些番剧更新（基于 airDay），发送系统通知提醒用户。
 * 每天最多提醒一次（通过 localStorage 记录上次提醒日期）。
 */

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

import type { TrackedAnime } from '../types';

const LAST_NOTIFY_KEY = 'pochan-last-notify-date';

/** 获取今天的日期字符串 YYYY-MM-DD */
function todayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 今天是否已经发过通知 */
function hasNotifiedToday(): boolean {
  try {
    return localStorage.getItem(LAST_NOTIFY_KEY) === todayKey();
  } catch {
    return false;
  }
}

/** 标记今天已通知 */
function markNotified(): void {
  try {
    localStorage.setItem(LAST_NOTIFY_KEY, todayKey());
  } catch {
    // 静默
  }
}

/**
 * 检查今日更新并发送通知
 *
 * 条件：
 * - 今天还没发过通知
 * - 有正在追的番今天更新（airDay 匹配今天的星期几）
 * - 用户授予了通知权限
 */
export async function checkAndNotifyTodayAiring(animes: TrackedAnime[]): Promise<void> {
  if (hasNotifiedToday()) return;

  // 找今天更新的番（在看 + airDay 匹配）
  const todayDow = new Date().getDay(); // 0=周日, 6=周六
  const airingToday = animes.filter((a) => {
    const isWatching = (a.watchStatus ?? 'watching') === 'watching';
    return isWatching && a.status === 'airing' && a.airDay === todayDow;
  });

  if (airingToday.length === 0) return;

  // 检查通知权限
  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === 'granted';
  }
  if (!granted) return;

  // 构建通知内容
  const names = airingToday
    .map((a) => a.nameCn || a.name || '未知')
    .slice(0, 5); // 最多显示 5 部

  const title = `今日有 ${airingToday.length} 部番剧更新`;
  const body = names.join('、') + (airingToday.length > 5 ? ' 等' : '');

  sendNotification({ title, body });
  markNotified();
}
