/**
 * 追番气泡（bangumi-bubble）核心类型定义
 *
 * 本文件包含：
 *   - TrackedAnime：用户追的番（业务模型）
 *   - AnimeFile：本地持久化容器
 *   - BangumiSearchResult / BangumiSubject：Bangumi API DTO
 *   - PALETTE 七色调色板与 pickPaletteColor 取色函数
 *
 * Validates: Requirements 3.11
 */

// ---------------------------------------------------------------------------
// 业务模型
// ---------------------------------------------------------------------------

/**
 * 老番观影目标。
 *
 * - targetEpisodes：希望看到的总集数（≥ 1）
 * - deadline：ISO 8601 日期字符串（合法日期）
 */
export interface AnimeGoal {
  targetEpisodes: number;
  deadline: string;
}

/**
 * 用户追的番。
 *
 * 字段约束（详见 design.md "Data Models / TrackedAnime"）：
 *   - id ≥ 1
 *   - name 与 nameCn 至少一个非空
 *   - totalEpisodes ≥ 0（部分长篇番为 0，表示未知）
 *   - watchedEpisodes 允许超过 totalEpisodes（OVA 加更）
 *   - status === 'airing' 时建议提供 airDay
 */
export interface TrackedAnime {
  // —— 来自 Bangumi ——
  /** Bangumi subject_id */
  id: number;
  /** 日文原名 */
  name: string;
  /** 中文名 */
  nameCn: string;
  /** 封面图 URL（lain.bgm.tv） */
  cover: string;
  /** 总集数 */
  totalEpisodes: number;

  // —— 追番状态 ——
  /** 已观看集数 */
  watchedEpisodes: number;
  /** 上次观看时间（ISO 8601） */
  lastWatchedAt: string;
  /** 添加时间（ISO 8601） */
  addedAt: string;

  // —— 类型（新番/老番） ——
  /** 番剧播出状态：airing 连载中、finished 已完结、upcoming 未播出 */
  status: 'airing' | 'finished' | 'upcoming';

  // —— 追番阶段（用户的观看状态） ——
  /**
   * 想看(plan) / 在看(watching) / 看完(completed) / 弃番(dropped)
   *
   * 默认 'watching'。气泡视图仅显示 watching 状态的番剧。
   * 字段为可选以便兼容旧数据：未设置时视为 'watching'。
   */
  watchStatus?: 'plan' | 'watching' | 'completed' | 'dropped';

  // —— 新番专属：更新日 ——
  /** 0-6，周日到周六 */
  airDay?: number;
  /** "HH:mm" */
  airTime?: string;

  // —— 老番专属：观影目标 ——
  goal?: AnimeGoal;

  // —— 视觉 ——
  /** 用户自定义 hex 颜色；未指定则从七色调色板按 id 取模分配 */
  color?: string;

  // —— 笔记 ——
  notes?: string;

  // —— 简介（来自 Bangumi summary） ——
  summary?: string;
}

// ---------------------------------------------------------------------------
// 持久化容器
// ---------------------------------------------------------------------------

/**
 * 本地 anime.json 的根结构。
 *
 * - version 当前固定为 1，未来升级时按版本路由 migration
 * - 解析失败时退化为 { version: 1, animes: [] }
 */
export interface AnimeFile {
  version: 1;
  animes: TrackedAnime[];
}

// ---------------------------------------------------------------------------
// Bangumi API DTO
// ---------------------------------------------------------------------------

/** Bangumi 搜索结果中的单条候选项 */
export interface BangumiSearchItem {
  id: number;
  name: string;
  name_cn: string;
  summary: string;
  air_date: string;
  images: { large: string; common: string };
  rating: { score: number; total: number };
}

/** POST /v0/search/subjects 的响应体 */
export interface BangumiSearchResult {
  total: number;
  data: BangumiSearchItem[];
}

/**
 * GET /v0/subjects/{id} 的响应体。
 *
 * 注意：Bangumi 的 air_weekday 为 1-7（周一到周日），
 * 需要由 Bangumi_Client 转换为内部 airDay（0-6，周日到周六）。
 */
export interface BangumiSubject {
  id: number;
  name: string;
  name_cn: string;
  summary: string;
  total_episodes: number;
  eps: number;
  air_date: string;
  air_weekday: number;
  images: { large: string; common: string };
}

// ---------------------------------------------------------------------------
// 调色板
// ---------------------------------------------------------------------------

/** 调色板单色：背景色 + 文字色 */
export interface PaletteColor {
  bg: string;
  text: string;
}

/**
 * 七色柔和调色板（紫、青、橙、粉、蓝、黄、绿）。
 *
 * 顺序与 design.md 严格一致；动画 id 按 `id % 7` 取色。
 */
export const PALETTE: readonly PaletteColor[] = [
  { bg: '#CECBF6', text: '#3C3489' }, // 紫
  { bg: '#9FE1CB', text: '#085041' }, // 青
  { bg: '#F5C4B3', text: '#712B13' }, // 橙
  { bg: '#F4C0D1', text: '#72243E' }, // 粉
  { bg: '#B5D4F4', text: '#0C447C' }, // 蓝
  { bg: '#FAC775', text: '#633806' }, // 黄
  { bg: '#C0DD97', text: '#27500A' }, // 绿
] as const;

/**
 * 按 animeId 从 PALETTE 中选取一组颜色。
 *
 * 性质（Property 4）：
 *   - 结果必落在 PALETTE 内（total）
 *   - 同一 id 多次调用结果相同（确定性）
 *   - 周期为 PALETTE.length（=7）：pickPaletteColor(id) === pickPaletteColor(id + 7)
 *   - 对负数 id 也成立（采用 `((id % len) + len) % len` 归一化）
 */
export function pickPaletteColor(animeId: number): PaletteColor {
  const len = PALETTE.length;
  // 归一化以兼容负数与非整数 id；对正整数等价于 `animeId % len`。
  const idx = (((animeId % len) + len) % len) | 0;
  // PALETTE 不为空，idx ∈ [0, len)，访问安全。
  return PALETTE[idx] as PaletteColor;
}
