/**
 * 观看历史记录
 *
 * 每次 +1 或 -1 操作都会生成一条记录。
 * 用于时间线展示和统计面板。
 */

export interface WatchHistoryEntry {
  /** 操作时间 ISO 8601 */
  timestamp: string;
  /** 番剧 ID */
  animeId: number;
  /** 操作类型 */
  action: 'increment' | 'decrement';
  /** 操作后的集数 */
  episodeAfter: number;
}

export interface WatchHistory {
  entries: WatchHistoryEntry[];
}
