/**
 * Staleness 算法：番剧「沉底度」与对应的视觉派生量。
 *
 * 实现 design.md "Core Algorithms / Staleness 与 Freshness" 与
 * requirements.md Requirement 3.1 / 3.2 / 3.6。
 *
 * 关键性质（Property 1）：对任意合法的 `lastWatchedAt` ISO 时间戳与当前时间 `now`，
 *   - staleness ∈ [0, 1]
 *   - now − lastWatchedAt 越大，staleness 单调不减
 *   - staleness + freshness === 1
 *   - opacity = 1 − staleness × 0.45 ∈ [0.55, 1]
 *
 * 本模块所有函数皆为纯函数，无副作用。
 *
 * Validates: Requirements 3.1, 3.2, 3.6
 */

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 一天对应的毫秒数 */
export const MS_PER_DAY = 24 * 3600 * 1000;

/** Staleness 饱和窗口（天）：超过该天数即认为完全沉底 */
export const STALENESS_WINDOW_DAYS = 14;

/** Opacity 随 staleness 衰减的系数（最大衰减幅度 0.45 → 最低 opacity 0.55） */
const OPACITY_DECAY = 0.45;

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 将数值钳制到 [min, max] 区间 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// 核心计算
// ---------------------------------------------------------------------------

/**
 * 计算番剧的 staleness（沉底度）：值域 [0, 1]。
 *
 * 公式：`staleness = clamp((now − lastWatchedAt) / (14 天), 0, 1)`
 *   - 刚看完（now ≈ lastWatchedAt）→ 0
 *   - 满 14 天或更久没看 → 1
 *   - 时间「负向流动」（lastWatchedAt 在未来）→ 钳到 0
 *
 * 解析失败的容错：当 `lastWatchedAtIso` 不能被 `Date.parse` 解析（NaN）时，
 * 视为「太久没看」并直接返回 1，避免上游因坏数据导致 NaN 渗透到物理引擎。
 *
 * @param now 当前时间，毫秒（通常为 `Date.now()`）
 * @param lastWatchedAtIso 上次观看时间的 ISO 8601 字符串
 * @returns staleness ∈ [0, 1]
 */
export function computeStaleness(now: number, lastWatchedAtIso: string): number {
  const last = Date.parse(lastWatchedAtIso);
  if (Number.isNaN(last)) {
    return 1;
  }
  const days = (now - last) / MS_PER_DAY;
  return clamp(days / STALENESS_WINDOW_DAYS, 0, 1);
}

/**
 * 基于频率计算 staleness（位置）。
 *
 * 只计算添加后新看的集数。
 * 频率 = 新看集数 / 实际添加天数（不归一化到 14 天）。
 *
 * 位置语义：
 *   - 底部（staleness=1）：0 集/天
 *   - 中间（staleness≈0.5）：1 集/天
 *   - 顶部（staleness=0）：10 集/天
 */
export function computeFrequencyStaleness(
  now: number,
  addedAtIso: string,
  watchedEpisodes: number,
  initialWatchedEpisodes: number = 0,
): number {
  const addedAt = Date.parse(addedAtIso);
  const newEpisodes = watchedEpisodes - initialWatchedEpisodes;
  if (Number.isNaN(addedAt) || newEpisodes <= 0) {
    return 1;
  }
  const daysSinceAdded = (now - addedAt) / MS_PER_DAY;
  // 最少半天，最多 14 天
  const days = clamp(daysSinceAdded, 0.5, STALENESS_WINDOW_DAYS);
  const frequency = newEpisodes / days; // 集/天

  // 对数映射：0→1, 1→≈0.5, 10→0
  // log(1+1)/log(11) ≈ 0.289 → staleness = 1-0.289 = 0.71... 不够中间
  // 用 log(freq*5 + 1) / log(51)：
  // freq=0: 0 → staleness=1
  // freq=1: log(6)/log(51) ≈ 0.456 → staleness≈0.54 ≈中间 ✓
  // freq=10: log(51)/log(51) = 1 → staleness=0 ✓
  const staleness = 1 - Math.log(frequency * 5 + 1) / Math.log(51);
  return clamp(staleness, 0, 1);
}

/**
 * 计算 freshness（新鲜度）：`1 − staleness`，值域 [0, 1]。
 *
 * Property 1 中要求 `staleness + freshness === 1`。当调用方传入的 staleness
 * 在 [0, 1] 之外（理论上不应发生，但出于防御）时，仍把结果钳到 [0, 1]。
 *
 * @param staleness 期望落在 [0, 1] 区间的 staleness
 * @returns freshness ∈ [0, 1]
 */
export function computeFreshness(staleness: number): number {
  return clamp(1 - staleness, 0, 1);
}

/**
 * 计算气泡透明度：`opacity = 1 − staleness × 0.45`，值域 [0.55, 1]。
 *
 * Property 1 保证当 staleness ∈ [0, 1] 时 opacity ∈ [0.55, 1]。
 * 与 freshness 相同，对越界 staleness 走防御性钳制。
 *
 * @param staleness 期望落在 [0, 1] 区间的 staleness
 * @returns opacity ∈ [0.55, 1]
 */
export function computeOpacity(staleness: number): number {
  return clamp(1 - staleness * OPACITY_DECAY, 1 - OPACITY_DECAY, 1);
}
