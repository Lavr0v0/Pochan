/**
 * Physics 层：matter.js 引擎的封装与气泡相关的物理计算。
 *
 * 实现 design.md "Core Algorithms"（Bubble Radius / Buoyancy / Jitter /
 * Click Feedback / Physics Engine Parameters）与 requirements.md
 * Requirements 3.3 / 3.4 / 3.7 / 3.8 / 3.9 / 3.10 / 3.12。
 *
 * 关键性质：
 *   - Property 2（气泡半径）：`computeBubbleRadius` 结果 ∈ [20, 64]，
 *     在 staleness 固定时 watched 单调不减，在 watched 固定时 staleness 单调不增。
 *   - Property 3（浮力方向）：`applyBuoyancy` 应用的力 y 分量符号严格由
 *     `freshness − 0.5` 决定（freshness > 0.5 → y < 0 向上；< 0.5 → y > 0 向下）。
 *   - Property 5（坐标重置）：`resetIfInvalid` 在 NaN/Infinity/越界时会把
 *     body 重置到画布中心并返回 true；正常坐标返回 false。
 *
 * 所有抖动 / 冲量函数都通过参数注入随机源 `rng`，便于属性测试用
 * 确定性 RNG 复现行为。
 */

import Matter, { Bodies, Body, Engine } from 'matter-js';

// ---------------------------------------------------------------------------
// 常量（来自 design.md Core Algorithms）
// ---------------------------------------------------------------------------

/** 气泡半径下限（保证文字可读） */
export const BUBBLE_RADIUS_MIN = 20;

/** 气泡基础半径 */
const BUBBLE_RADIUS_BASE = 32;

/** watched 增量带来的最大额外半径（基础半径 + MAX = 64 上限） */
const BUBBLE_RADIUS_WATCHED_CAP = 32;

/** 每 watched 集对应的半径增量（受 BUBBLE_RADIUS_WATCHED_CAP 封顶） */
const BUBBLE_RADIUS_PER_WATCHED = 3.5;

/** staleness 满值时半径的最大缩减 */
const BUBBLE_RADIUS_STALENESS_PENALTY = 10;

/** 气泡半径理论上限 = base + watched_cap = 64 */
export const BUBBLE_RADIUS_MAX = BUBBLE_RADIUS_BASE + BUBBLE_RADIUS_WATCHED_CAP;

/** 浮力强度系数（每帧应用的力 y = -(freshness − 0.5) × 此值）
 * 
 * 设计意图：staleness 以天为单位变化，用户观察的几分钟内气泡不应有明显浮沉。
 * 浮力极弱，仅在长时间累积后才让气泡缓慢漂移到对应位置。
 */
const BUOYANCY_STRENGTH = 0.00003;

/** 每帧施加微抖动的概率（1%，极低频率产生轻微呼吸感） */
const JITTER_PROBABILITY = 0.01;

/** 微抖动力的幅值（极小，仅产生几乎不可察觉的轻微晃动） */
const JITTER_AMPLITUDE = 0.00008;

/** 点击冲量水平随机分量的幅值（小幅偏移，不会飞太远） */
const CLICK_IMPULSE_HORIZONTAL = 0.002;

/** 点击冲量垂直分量（轻微向上弹一下） */
const CLICK_IMPULSE_VERTICAL = -0.005;

/** 物理墙体默认厚度，沿画布外侧伸出，避免与气泡视觉重叠 */
const DEFAULT_WALL_THICKNESS = 50;

/** 重置坐标后的微弱随机速度幅值 */
const RESET_VELOCITY_AMPLITUDE = 0.5;

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 将数值钳制到 [min, max] 区间 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 正常化 watchedEpisodes：负数 / NaN / Infinity 一律视为 0 */
function normalizeWatched(watchedEpisodes: number): number {
  if (!Number.isFinite(watchedEpisodes) || watchedEpisodes < 0) return 0;
  return watchedEpisodes;
}

/** 判断 x 是否为有限实数 */
function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

// ---------------------------------------------------------------------------
// 半径计算（Property 2）
// ---------------------------------------------------------------------------

/**
 * 计算气泡半径。
 *
 * 公式：`radius = max(20, 32 + min(watched × 3.5, 32) − staleness × 10)`
 *
 * 性质（Property 2）：
 *   - 结果 ∈ [20, 64]
 *   - staleness 固定时，watched 增大 → radius 单调不减（直至上限）
 *   - watched 固定时，staleness 增大 → radius 单调不增
 *
 * 防御性约束：
 *   - watchedEpisodes 为负数 / NaN / Infinity 时按 0 处理
 *   - staleness 钳制到 [0, 1] 区间
 *
 * @param watchedEpisodes 已观看集数
 * @param staleness 沉底度，期望落在 [0, 1] 区间
 */
export function computeBubbleRadius(
  watchedEpisodes: number,
  staleness: number,
): number {
  const watched = normalizeWatched(watchedEpisodes);
  const stale = clamp(Number.isFinite(staleness) ? staleness : 1, 0, 1);
  const watchedBoost = Math.min(watched * BUBBLE_RADIUS_PER_WATCHED, BUBBLE_RADIUS_WATCHED_CAP);
  const raw = BUBBLE_RADIUS_BASE + watchedBoost - stale * BUBBLE_RADIUS_STALENESS_PENALTY;
  return Math.max(BUBBLE_RADIUS_MIN, raw);
}

// ---------------------------------------------------------------------------
// 引擎与刚体工厂（Requirements 3.7 / 3.8 / 3.10）
// ---------------------------------------------------------------------------

/**
 * 创建一个 matter.js Engine 并将世界重力归零。
 *
 * 因为气泡的运动完全由 buoyancy + jitter + click impulse 驱动，
 * 我们不希望默认的 (0, 1) 重力把它们直接拽向底部。
 */
export function createEngine(): Matter.Engine {
  const engine = Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = 0;
  return engine;
}

/**
 * 创建单只气泡的物理刚体（圆形）。
 *
 * 参数调整说明：
 *   - restitution: 0.4 → 碰撞后回弹较小，不会弹来弹去
 *   - friction: 0.05 → 适度表面摩擦
 *   - frictionAir: 0.15 → 高空气阻力，气泡很快静止（核心：避免持续飘动）
 *   - density: 0.001 → 轻量
 */
export function createBubbleBody(x: number, y: number, r: number): Matter.Body {
  return Bodies.circle(x, y, r, {
    restitution: 0.4,
    friction: 0.05,
    frictionAir: 0.15,
    density: 0.001,
  });
}

/**
 * 创建画布四面静态墙体（顶 / 底 / 左 / 右）。
 *
 * 墙体位于画布外侧（恰好贴边），厚度 `thickness`；长度方向多伸出
 * `thickness * 2` 以避免角落处出现缝隙。
 *
 * @param width 画布宽度（CSS 像素）
 * @param height 画布高度（CSS 像素）
 * @param thickness 单面墙厚度，默认 50
 * @returns `[top, bottom, left, right]` 四个 isStatic 刚体
 */
export function createWalls(
  width: number,
  height: number,
  thickness: number = DEFAULT_WALL_THICKNESS,
): Matter.Body[] {
  const opts: Matter.IChamferableBodyDefinition = { isStatic: true };
  const long = (axis: number) => axis + thickness * 2;
  const top = Bodies.rectangle(width / 2, -thickness / 2, long(width), thickness, opts);
  const bottom = Bodies.rectangle(
    width / 2,
    height + thickness / 2,
    long(width),
    thickness,
    opts,
  );
  const left = Bodies.rectangle(-thickness / 2, height / 2, thickness, long(height), opts);
  const right = Bodies.rectangle(
    width + thickness / 2,
    height / 2,
    thickness,
    long(height),
    opts,
  );
  return [top, bottom, left, right];
}

// ---------------------------------------------------------------------------
// 每帧力（Requirements 3.4 / 3.9）
// ---------------------------------------------------------------------------

/**
 * 对刚体施加浮力。
 *
 * 力公式：`{ x: 0, y: -(freshness − 0.5) × 0.0008 }`
 *   - freshness > 0.5 → y < 0（向上浮）
 *   - freshness < 0.5 → y > 0（向下沉）
 *   - freshness = 0.5 → 不施加（中性）
 *   - freshness = 0   → 持续向下推到画布底部（Property 3）
 *
 * 防御性约束：freshness 钳到 [0, 1]；非有限值按 0 处理。
 */
export function applyBuoyancy(body: Matter.Body, freshness: number): void {
  const f = clamp(Number.isFinite(freshness) ? freshness : 0, 0, 1);
  Body.applyForce(body, body.position, {
    x: 0,
    y: -(f - 0.5) * BUOYANCY_STRENGTH,
  });
}

/**
 * 以 4% 概率施加随机微抖动力，让画面带「呼吸感」。
 *
 * 力分量在 `[-0.0003, 0.0003]` 之间（`(rng() − 0.5) × 0.0006`）。
 *
 * @param body 目标刚体
 * @param rng 随机源；测试时可注入确定性函数。默认 `Math.random`
 */
export function applyJitter(body: Matter.Body, rng: () => number = Math.random): void {
  if (rng() >= JITTER_PROBABILITY) return;
  Body.applyForce(body, body.position, {
    x: (rng() - 0.5) * JITTER_AMPLITUDE,
    y: (rng() - 0.5) * JITTER_AMPLITUDE,
  });
}

/**
 * 用户单击气泡时施加的冲量。
 *
 * 力公式：`{ x: (rng() − 0.5) × 0.005, y: -0.012 }`
 *   - 水平分量随机左右偏移
 *   - 垂直分量恒为向上
 *
 * @param body 目标刚体
 * @param rng 随机源；测试时可注入确定性函数。默认 `Math.random`
 */
export function applyClickImpulse(body: Matter.Body, rng: () => number = Math.random): void {
  Body.applyForce(body, body.position, {
    x: (rng() - 0.5) * CLICK_IMPULSE_HORIZONTAL,
    y: CLICK_IMPULSE_VERTICAL,
  });
}

// ---------------------------------------------------------------------------
// 异常坐标自愈（Requirement 3.12 / Property 5）
// ---------------------------------------------------------------------------

/**
 * 检测刚体坐标是否非法（NaN / ±Infinity / 越出画布矩形 [0, W] × [0, H]）。
 *
 * 越界判定使用闭区间 `[0, width]` × `[0, height]`：刚好贴边视为合法，
 * 避免新创建的刚体（坐标可能恰为画布中心或边缘）被误判。
 */
function isInvalidPosition(
  position: { x: number; y: number },
  width: number,
  height: number,
): boolean {
  const { x, y } = position;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return true;
  if (x < 0 || x > width) return true;
  if (y < 0 || y > height) return true;
  return false;
}

/**
 * 当刚体坐标异常时，重置到画布中心并施加微弱随机速度。
 *
 * 性质（Property 5）：重置后 body.position 必为有限实数且 ∈ [0, W] × [0, H]。
 *
 * @param body 物理刚体
 * @param width 画布宽度
 * @param height 画布高度
 * @returns 是否触发了重置
 */
export function resetIfInvalid(
  body: Matter.Body,
  width: number,
  height: number,
): boolean {
  if (!isInvalidPosition(body.position, width, height)) return false;
  Body.setPosition(body, { x: width / 2, y: height / 2 });
  Body.setVelocity(body, {
    x: (Math.random() - 0.5) * RESET_VELOCITY_AMPLITUDE,
    y: (Math.random() - 0.5) * RESET_VELOCITY_AMPLITUDE,
  });
  return true;
}
