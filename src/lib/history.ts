/**
 * 观看历史管理
 *
 * 记录每次 +1/-1 操作的时间戳，用于时间线和统计。
 * 数据存储在 localStorage（轻量，不走文件系统）。
 */

import type { WatchHistoryEntry } from '../types/history';

const STORAGE_KEY = 'pochan-watch-history';

/** 最多保留的历史记录条数 */
const MAX_ENTRIES = 5000;

/** 读取所有历史记录 */
export function getHistory(): WatchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // 静默
  }
  return [];
}

/** 添加一条历史记录 */
export function addHistoryEntry(entry: WatchHistoryEntry): void {
  try {
    const history = getHistory();
    history.push(entry);
    // 超过上限时裁剪旧记录
    if (history.length > MAX_ENTRIES) {
      history.splice(0, history.length - MAX_ENTRIES);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // 静默
  }
}

/** 记录一次 +1 操作 */
export function recordIncrement(animeId: number, episodeAfter: number): void {
  addHistoryEntry({
    timestamp: new Date().toISOString(),
    animeId,
    action: 'increment',
    episodeAfter,
  });
}

/** 记录一次 -1 操作 */
export function recordDecrement(animeId: number, episodeAfter: number): void {
  addHistoryEntry({
    timestamp: new Date().toISOString(),
    animeId,
    action: 'decrement',
    episodeAfter,
  });
}

/** 获取指定时间范围内的历史记录 */
export function getHistoryInRange(startIso: string, endIso: string): WatchHistoryEntry[] {
  return getHistory().filter((e) => e.timestamp >= startIso && e.timestamp <= endIso);
}

/** 获取指定番剧的历史记录 */
export function getHistoryForAnime(animeId: number): WatchHistoryEntry[] {
  return getHistory().filter((e) => e.animeId === animeId);
}

/** 获取今天的观看集数 */
export function getTodayWatchCount(): number {
  const today = new Date().toISOString().slice(0, 10);
  return getHistory().filter(
    (e) => e.action === 'increment' && e.timestamp.startsWith(today)
  ).length;
}

/** 获取最近 N 天每天的观看集数 */
export function getDailyWatchCounts(days: number): { date: string; count: number }[] {
  const history = getHistory();
  const result: { date: string; count: number }[] = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const count = history.filter(
      (e) => e.action === 'increment' && e.timestamp.startsWith(dateStr)
    ).length;
    result.push({ date: dateStr, count });
  }

  return result;
}

/** 获取统计摘要 */
export function getStats(_animeCount: number): {
  totalEpisodesWatched: number;
  totalDaysActive: number;
  averagePerDay: number;
  mostActiveDay: { date: string; count: number } | null;
  streak: number;
} {
  const history = getHistory().filter((e) => e.action === 'increment');
  const totalEpisodesWatched = history.length;

  // 活跃天数
  const activeDays = new Set(history.map((e) => e.timestamp.slice(0, 10)));
  const totalDaysActive = activeDays.size;

  // 平均每天
  const averagePerDay = totalDaysActive > 0 ? totalEpisodesWatched / totalDaysActive : 0;

  // 最活跃的一天
  const dayCounts = new Map<string, number>();
  for (const e of history) {
    const day = e.timestamp.slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  let mostActiveDay: { date: string; count: number } | null = null;
  for (const [date, count] of dayCounts) {
    if (!mostActiveDay || count > mostActiveDay.count) {
      mostActiveDay = { date, count };
    }
  }

  // 连续观看天数（从今天往回数）
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    if (activeDays.has(dateStr)) {
      streak++;
    } else {
      break;
    }
  }

  return { totalEpisodesWatched, totalDaysActive, averagePerDay, mostActiveDay, streak };
}
