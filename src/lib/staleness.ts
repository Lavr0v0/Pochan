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
 * 位置语义：
 *   - 顶部（staleness=0）：10 集/天
 *   - 正中间（staleness=0.5）：1 集/天
 *   - 底部（staleness=1）：0 集/14 天（完全不看）
 *
 * 使用对数映射让中间区域有更好的分辨率：
 *   staleness = 1 - log(frequency + 1) / log(11)
 *   其中 frequency = watchedEpisodes / windowDays
 */
export function computeFrequencyStaleness(
  now: number,
  addedAtIso: string,
  watchedEpisodes: number,
): number {
  const addedAt = Date.parse(addedAtIso);
  if (Number.isNaN(addedAt) || watchedEpisodes <= 0) {
    return 1; // 没看过 → 底部
  }
  const daysSinceAdded = (now - addedAt) / MS_PER_DAY;
  // 窗口：下限 0.5 天（避免除零），上限 14 天
  const windowDays = clamp(daysSinceAdded, 0.5, STALENESS_WINDOW_DAYS);
  const frequency = watchedEpisodes / windowDays; // 集/天

  // log 映射：frequency=10 → staleness≈0, frequency=1 → staleness≈0.5, frequency=0 → staleness=1
  // log(10+1)/log(11) = 1 → staleness = 0
  // log(1+1)/log(11) ≈ 0.29 → staleness ≈ 0.71... 不太对
  // 用更直接的公式：staleness = 1 - clamp(log2(frequency + 1) / log2(11), 0, 1)
  // log2(11) ≈ 3.459
  // frequency=10: log2(11)/log2(11) = 1 → staleness = 0 ✓
  // frequency=1: log2(2)/log2(11) ≈ 0.289 → staleness ≈ 0.71... 还是不对

  // 换个思路：用幂函数。设 staleness = 1 - (frequency / 10)^p
  // 要求 frequency=1 时 staleness=0.5 → 0.5 = 1 - (1/10)^p → (0.1)^p = 0.5
  // p = log(0.5) / log(0.1) ≈ 0.301
  const p = 0.301;
  const normalized = clamp(frequency / 10, 0, 1);
  return clamp(1 - Math.pow(normalized, p), 0, 1);
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
