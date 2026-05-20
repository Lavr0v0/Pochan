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

/** 获取今天的净观看集数 */
export function getTodayWatchCount(): number {
  const today = new Date().toISOString().slice(0, 10);
  const todayEntries = getHistory().filter((e) => e.timestamp.startsWith(today));
  let net = 0;
  for (const e of todayEntries) {
    net += e.action === 'increment' ? 1 : -1;
  }
  return Math.max(0, net);
}

/** 获取最近 N 天每天的净观看集数 */
export function getDailyWatchCounts(days: number): { date: string; count: number }[] {
  const history = getHistory();
  const result: { date: string; count: number }[] = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    let net = 0;
    for (const e of history) {
      if (e.timestamp.startsWith(dateStr)) {
        net += e.action === 'increment' ? 1 : -1;
      }
    }
    result.push({ date: dateStr, count: Math.max(0, net) });
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
  const history = getHistory();
  
  // 净观看集数：increment - decrement
  const increments = history.filter((e) => e.action === 'increment').length;
  const decrements = history.filter((e) => e.action === 'decrement').length;
  const totalEpisodesWatched = Math.max(0, increments - decrements);

  // 活跃天数（只算净增为正的天）
  const dayNet = new Map<string, number>();
  for (const e of history) {
    const day = e.timestamp.slice(0, 10);
    const delta = e.action === 'increment' ? 1 : -1;
    dayNet.set(day, (dayNet.get(day) ?? 0) + delta);
  }
  const activeDays = new Set<string>();
  for (const [day, net] of dayNet) {
    if (net > 0) activeDays.add(day);
  }
  const totalDaysActive = activeDays.size;

  // 平均每天
  const averagePerDay = totalDaysActive > 0 ? totalEpisodesWatched / totalDaysActive : 0;

  // 最活跃的一天（净增最多）
  let mostActiveDay: { date: string; count: number } | null = null;
  for (const [date, net] of dayNet) {
    if (net > 0 && (!mostActiveDay || net > mostActiveDay.count)) {
      mostActiveDay = { date, count: net };
    }
  }

  // 连续观看天数（从今天往回数，只算净增 > 0 的天）
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
