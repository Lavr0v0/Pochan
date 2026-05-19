/**
 * Bangumi API 客户端
 *
 * 实现 design.md "Bangumi API Integration" 与 requirements.md Requirement 7。
 *
 * 关键性质：
 *   - 所有请求附带 `User-Agent: lavro/bangumi-bubble (https://lavro.org)`，
 *     不加会被 Bangumi 限流甚至 403。
 *   - 通过 `@tauri-apps/plugin-http` 的 `fetch` 发起请求（绕过浏览器 CORS）。
 *   - 非 2xx 状态抛出 `BangumiError`，保留 status 与 bodyText。
 *   - `air_weekday`（1-7，周一到周日）→ 内部 `airDay`（0-6，周日到周六）。
 *   - 提供 `setBangumiFetch(f)` 注入点，允许测试替换底层 fetch
 *     而不必拦截整个 `@tauri-apps/plugin-http`。
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type {
  AnimeGoal,
  BangumiSearchResult,
  BangumiSubject,
  TrackedAnime,
} from '../types';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** Bangumi API 基础地址 */
export const BANGUMI_BASE = 'https://api.bgm.tv';

/** Bangumi 要求的 User-Agent，缺失会被限流 */
export const BANGUMI_USER_AGENT = 'pochan/0.1.0 (https://github.com/user/pochan)';

/** 所有请求共用的 header */
export const DEFAULT_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': BANGUMI_USER_AGENT,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

/** Bangumi 搜索接口 type 过滤值：2 = 动画 */
const SUBJECT_TYPE_ANIME = 2;

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/**
 * Bangumi API 调用错误。
 *
 * 字段：
 *   - status: HTTP 状态码（非 2xx）
 *   - bodyText: 响应体原文（用于诊断）
 */
export class BangumiError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
  ) {
    super(`Bangumi API error ${status}: ${bodyText}`);
    this.name = 'BangumiError';
    // 修正原型链，便于 instanceof 在 ES5 target 下也能工作
    Object.setPrototypeOf(this, BangumiError.prototype);
  }
}

// ---------------------------------------------------------------------------
// 可注入 fetch（便于测试）
// ---------------------------------------------------------------------------

/** 与 plugin-http / 全局 fetch 兼容的 fetch 函数签名 */
export type FetchLike = typeof tauriFetch;

/**
 * 当前生效的 fetch 实现。
 *
 * 默认使用 `@tauri-apps/plugin-http` 的 fetch；
 * 测试中可通过 `setBangumiFetch` 替换为 mock。
 */
let activeFetch: FetchLike = tauriFetch;

/** 替换底层 fetch 实现（测试入口） */
export function setBangumiFetch(f: FetchLike): void {
  activeFetch = f;
}

/** 还原为默认的 plugin-http fetch（测试 teardown 用） */
export function resetBangumiFetch(): void {
  activeFetch = tauriFetch;
}

// ---------------------------------------------------------------------------
// 工具：统一错误处理
// ---------------------------------------------------------------------------

/**
 * 若响应非 2xx，则读取响应体并抛出 BangumiError。
 *
 * 注意：res.text() 失败时仍构造 BangumiError，bodyText 退化为占位字符串，
 * 避免错误处理过程本身再抛出更不可读的错误。
 */
async function ensureOk(res: Response): Promise<void> {
  if (res.ok) return;
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    bodyText = '<failed to read response body>';
  }
  throw new BangumiError(res.status, bodyText);
}

// ---------------------------------------------------------------------------
// API 方法
// ---------------------------------------------------------------------------

/**
 * 搜索动画番剧（type=2）。
 *
 * 调用 `POST /v0/search/subjects`，body `{ keyword, filter: { type: [2] } }`。
 *
 * 不在此处对 keyword 做空白校验：调用方（AddAnimeDialog）应自行判定，
 * 这样客户端保持纯粹的 HTTP 适配器语义。
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.6
 */
export async function searchSubjects(keyword: string): Promise<BangumiSearchResult> {
  const url = `${BANGUMI_BASE}/v0/search/subjects`;
  const res = await activeFetch(url, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({ keyword, filter: { type: [SUBJECT_TYPE_ANIME] } }),
  });
  await ensureOk(res);
  return (await res.json()) as BangumiSearchResult;
}

/**
 * 获取番剧详情。
 *
 * 调用 `GET /v0/subjects/{id}`。
 *
 * Validates: Requirements 7.1, 7.2, 7.4, 7.6
 */
export async function getSubject(id: number): Promise<BangumiSubject> {
  const url = `${BANGUMI_BASE}/v0/subjects/${id}`;
  const res = await activeFetch(url, {
    method: 'GET',
    headers: DEFAULT_HEADERS,
  });
  await ensureOk(res);
  return (await res.json()) as BangumiSubject;
}

// ---------------------------------------------------------------------------
// air_weekday ↔ airDay 转换
// ---------------------------------------------------------------------------

/**
 * 获取番剧已播出的集数（通过 episodes API）。
 *
 * 调用 `GET /v0/episodes?subject_id={id}&type=0`，统计 airdate <= 今天的集数。
 * 用于新番场景：totalEpisodes 用已播出集数作为当前上限。
 */
export async function getAiredEpisodeCount(subjectId: number): Promise<number> {
  const url = `${BANGUMI_BASE}/v0/episodes?subject_id=${subjectId}&type=0&limit=100`;
  try {
    const res = await activeFetch(url, { method: 'GET', headers: DEFAULT_HEADERS });
    if (!res.ok) return 0;
    const json = (await res.json()) as { data?: Array<{ airdate?: string }> };
    if (!json.data) return 0;
    const today = new Date().toISOString().slice(0, 10);
    return json.data.filter((ep) => ep.airdate && ep.airdate <= today).length;
  } catch {
    return 0; // 失败时回退到 0，不阻塞添加流程
  }
}

/**
 * 自动判断番剧播出状态。
 *
 * 三种状态：
 *   - upcoming：air_date 在未来（还没开播）
 *   - airing：已开播 + 有 air_weekday（还在连载更新中）
 *   - finished：已开播 + 没有 air_weekday，或者总集数已知且全部播完
 *
 * 海贼王这种长篇（有 air_weekday）也会被判为 airing。
 */
export function inferStatus(subject: BangumiSubject): 'airing' | 'finished' | 'upcoming' {
  const today = new Date().toISOString().slice(0, 10);

  // 有 air_date 且在未来 → 未播出
  if (subject.air_date && subject.air_date > today) {
    return 'upcoming';
  }

  // 没有开播日期 → 已完结（无法判断）
  if (!subject.air_date) {
    return 'finished';
  }

  // 有 air_weekday 且总集数已知：检查是否已经播完
  // 估算结束日期 = 开播日 + 总集数 * 7 天
  if (Number.isInteger(subject.air_weekday) && subject.air_weekday >= 1 && subject.air_weekday <= 7) {
    const totalEps = subject.total_episodes || subject.eps || 0;
    if (totalEps > 0) {
      const startDate = new Date(subject.air_date);
      const estimatedEnd = new Date(startDate.getTime() + totalEps * 7 * 24 * 60 * 60 * 1000);
      const now = new Date();
      if (now < estimatedEnd) {
        return 'airing';
      }
      // 已经超过预计结束日期 → 完结
      return 'finished';
    }
    // 总集数未知但有 air_weekday → 可能是长篇连载（如海贼王）
    return 'airing';
  }

  // 没有 air_weekday → 已完结
  return 'finished';
}

/**
 * Bangumi `air_weekday`（1-7，周一到周日）→ 内部 `airDay`（0-6，周日到周六）。
 *
 * 映射表：
 *   air_weekday: 1=周一 2=周二 3=周三 4=周四 5=周五 6=周六 7=周日
 *   airDay     : 1=周一 2=周二 3=周三 4=周四 5=周五 6=周六 0=周日
 *
 * 因此规则即「7 → 0，其余原值返回」。
 *
 * 输入越界（不在 1..7）抛 RangeError，由调用方决定是否兜底。
 *
 * 性质（Property 6）：
 *   - 结果 ∈ {0..6}
 *   - 周日 ↔ 0、周一 ↔ 1、…、周六 ↔ 6
 *   - convertAirDayBack(convertAirWeekday(x)) === x（双向 round-trip）
 *
 * Validates: Requirements 1.6, 7.5
 */
export function convertAirWeekday(airWeekday: number): number {
  if (
    !Number.isInteger(airWeekday) ||
    airWeekday < 1 ||
    airWeekday > 7
  ) {
    throw new RangeError(`air_weekday must be an integer in 1..7, got ${airWeekday}`);
  }
  return airWeekday === 7 ? 0 : airWeekday;
}

/**
 * 内部 `airDay`（0-6）→ Bangumi `air_weekday`（1-7）反向映射。
 *
 * 与 convertAirWeekday 互为反函数。
 */
export function convertAirDayBack(airDay: number): number {
  if (
    !Number.isInteger(airDay) ||
    airDay < 0 ||
    airDay > 6
  ) {
    throw new RangeError(`airDay must be an integer in 0..6, got ${airDay}`);
  }
  return airDay === 0 ? 7 : airDay;
}

// ---------------------------------------------------------------------------
// DTO → 业务模型
// ---------------------------------------------------------------------------

/**
 * AddAnimeDialog 提交时收集的表单输入。
 *
 * - status：用户在表单中选定的类型（airing / finished）
 * - watchedEpisodes：当前已看集数（≥ 0；可超过 totalEpisodes）
 * - airDay：可选，新番更新日（0-6）；通常由 Bangumi 的 air_weekday 推断默认值，
 *   但允许用户覆盖
 * - airTime：可选，"HH:mm"
 * - goal：可选，老番观影目标
 * - color：可选，自定义 hex 颜色
 * - notes：可选，笔记
 */
export interface AddAnimeFormInput {
  status: 'airing' | 'finished' | 'upcoming';
  watchedEpisodes: number;
  airDay?: number;
  airTime?: string;
  goal?: AnimeGoal;
  color?: string;
  notes?: string;
}

/**
 * 工厂：把 BangumiSubject + 表单输入合并为 TrackedAnime。
 *
 * 行为约定：
 *   - id：直接来自 subject
 *   - name：subject.name（日文原名）
 *   - nameCn：subject.name_cn 为空时回退到 subject.name，确保 name 与 nameCn 至少一个非空
 *   - cover：subject.images.large
 *   - totalEpisodes：优先 subject.total_episodes，回退 subject.eps，再回退 0
 *   - watchedEpisodes：来自表单
 *   - addedAt / lastWatchedAt：当前 ISO 时间戳（store 在 addAnime 时通常会再赋一次，
 *     此处保证字段存在以满足 TrackedAnime schema）
 *   - status：来自表单
 *   - airDay：优先表单值；否则当 subject.air_weekday 合法时由其推断；否则不写
 *   - airTime / goal / color / notes：透传表单可选字段
 */
export function bangumiSubjectToTrackedAnime(
  subject: BangumiSubject,
  form: AddAnimeFormInput,
): TrackedAnime {
  const now = new Date().toISOString();

  // —— 名称回退 ——
  const name = subject.name ?? '';
  const nameCnRaw = subject.name_cn ?? '';
  const nameCn = nameCnRaw.length > 0 ? nameCnRaw : name;

  // —— 总集数回退 ——
  const totalEpisodes =
    typeof subject.total_episodes === 'number' && subject.total_episodes > 0
      ? subject.total_episodes
      : typeof subject.eps === 'number' && subject.eps > 0
        ? subject.eps
        : 0;

  // —— airDay 推断 ——
  let airDay: number | undefined = form.airDay;
  if (
    airDay === undefined &&
    Number.isInteger(subject.air_weekday) &&
    subject.air_weekday >= 1 &&
    subject.air_weekday <= 7
  ) {
    airDay = convertAirWeekday(subject.air_weekday);
  }

  const tracked: TrackedAnime = {
    id: subject.id,
    name,
    nameCn,
    cover: subject.images?.large ?? '',
    totalEpisodes,

    watchedEpisodes: form.watchedEpisodes,
    lastWatchedAt: now,
    addedAt: now,

    status: form.status,
  };

  if (airDay !== undefined) tracked.airDay = airDay;
  if (form.airTime !== undefined) tracked.airTime = form.airTime;
  if (form.goal !== undefined) tracked.goal = form.goal;
  if (form.color !== undefined) tracked.color = form.color;
  if (form.notes !== undefined) tracked.notes = form.notes;
  // 保存简介
  if (subject.summary) tracked.summary = subject.summary;

  return tracked;
}

// ---------------------------------------------------------------------------
// 用户收藏导入（从 Bangumi 账号导入追番列表）
// ---------------------------------------------------------------------------

/** Bangumi 收藏状态 → 内部 watchStatus 映射 */
const COLLECTION_TYPE_MAP: Record<number, 'plan' | 'watching' | 'completed' | 'dropped'> = {
  1: 'plan',       // wish（想看）
  2: 'completed',  // collect（看过）
  3: 'watching',   // doing（在看）
  4: 'dropped',    // on_hold → 暂时映射为 dropped
  5: 'dropped',    // dropped（抛弃）
};

/** Bangumi 用户收藏列表中的单条 */
export interface BangumiCollectionItem {
  subject_id: number;
  subject: {
    id: number;
    name: string;
    name_cn: string;
    images: { large: string; common: string };
    air_date: string;
    air_weekday: number;
    summary: string;
    eps: number;
    total_episodes?: number;
  };
  type: number; // 1=wish 2=collect 3=doing 4=on_hold 5=dropped
  ep_status: number; // 已看集数
}

/** GET /v0/users/{username}/collections 的响应 */
export interface BangumiCollectionsResponse {
  total: number;
  limit: number;
  offset: number;
  data: BangumiCollectionItem[];
}

/**
 * 获取 Bangumi 用户的动画收藏列表（公开，不需要 token）。
 *
 * @param username Bangumi 用户名或 UID
 * @param offset 分页偏移
 * @param limit 每页数量（最大 50）
 */
export async function getUserCollections(
  username: string,
  offset = 0,
  limit = 50,
): Promise<BangumiCollectionsResponse> {
  const url = `${BANGUMI_BASE}/v0/users/${encodeURIComponent(username)}/collections?subject_type=2&limit=${limit}&offset=${offset}`;
  const res = await activeFetch(url, {
    method: 'GET',
    headers: DEFAULT_HEADERS,
  });
  await ensureOk(res);
  return (await res.json()) as BangumiCollectionsResponse;
}

/**
 * 从 Bangumi 用户收藏批量导入为 TrackedAnime 数组。
 *
 * 会自动分页拉取全部收藏（最多 500 条，避免无限循环）。
 */
export async function importFromBangumi(username: string): Promise<TrackedAnime[]> {
  const all: BangumiCollectionItem[] = [];
  let offset = 0;
  const limit = 50;
  const maxItems = 500;

  while (offset < maxItems) {
    const res = await getUserCollections(username, offset, limit);
    if (!res.data || res.data.length === 0) break;
    all.push(...res.data);
    if (all.length >= res.total || res.data.length < limit) break;
    offset += limit;
  }

  const now = new Date().toISOString();
  return all.map((item): TrackedAnime => {
    const subject = item.subject;
    const name = subject.name ?? '';
    const nameCnRaw = subject.name_cn ?? '';
    const nameCn = nameCnRaw.length > 0 ? nameCnRaw : name;
    const totalEpisodes = subject.total_episodes ?? subject.eps ?? 0;

    let airDay: number | undefined;
    if (Number.isInteger(subject.air_weekday) && subject.air_weekday >= 1 && subject.air_weekday <= 7) {
      airDay = convertAirWeekday(subject.air_weekday);
    }

    const watchStatus = COLLECTION_TYPE_MAP[item.type] ?? 'watching';

    return {
      id: subject.id,
      name,
      nameCn,
      cover: subject.images?.large ?? '',
      totalEpisodes,
      watchedEpisodes: item.ep_status ?? 0,
      lastWatchedAt: now,
      addedAt: now,
      status: totalEpisodes > 0 && item.ep_status >= totalEpisodes ? 'finished' : 'airing',
      watchStatus,
      airDay,
      summary: subject.summary ?? undefined,
    };
  });
}
