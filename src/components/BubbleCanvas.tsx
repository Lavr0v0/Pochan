/**
 * BubbleCanvas — 气泡物理画布
 *
 * 使用 Matter.js 做物理模拟，位置通过 CSS 变量直写 DOM（不触发 React 重渲）。
 * staleness 低频刷新（5s）让 size/opacity 缓慢演化，物理引擎保持 60fps。
 * ResizeObserver 跟踪容器尺寸，尺寸变化时重建墙体。
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Matter, { Body, Composite, Engine } from 'matter-js';

import type { TrackedAnime } from '../types';
import { pickPaletteColor } from '../types';
import { computeOpacity, computeFrequencyStaleness } from '../lib/staleness';
import {
  applyClickImpulse,
  computeBubbleRadius,
  createBubbleBody,
  createEngine,
  createWalls,
  resetIfInvalid,
} from '../lib/physics';

import { Bubble } from './Bubble';
import './BubbleCanvas.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BubbleCanvasProps {
  /** 当前要展示的番剧列表 */
  animes: TrackedAnime[];
  /** 正在播放完成动画的 anime id */
  completingId?: number | null;
  /**
   * 单击回调。
   *
   * BubbleCanvas 内部已经处理了视觉反馈（.is-active scale 动画）与物理冲量
   * （applyClickImpulse），父组件在此回调里通常只需要调用
   * `useAnimeStore.incrementWatched(animeId)` 即可。
   */
  onBubbleClick?: (animeId: number) => void;
  /** 双击：父组件用于打开 AnimeDetailModal */
  onBubbleDoubleClick?: (animeId: number) => void;
  /** 右键：父组件用于在 (x, y) 处弹出上下文菜单 */
  onBubbleContextMenu?: (animeId: number, x: number, y: number) => void;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** stalenessTick 节拍间隔：让 size/opacity 每 5s 通过 React 重渲一次跟上 staleness 演化 */
const STALENESS_RERENDER_INTERVAL_MS = 5000;

/** 单帧最大 dt（ms）；超过此值钳制（标签页切回时避免一次大跳） */
const MAX_FRAME_DT_MS = 33;

/** 入场动画 CSS 类名 */
const ENTER_CLASS = 'bubble--entering';

/** 入场动画时长（ms），与 bubble.css 中 keyframes 一致 */
const ENTER_DURATION_MS = 250;

/** 初始默认尺寸（在 ResizeObserver 首次触发前使用） */
const FALLBACK_WIDTH = 800;
const FALLBACK_HEIGHT = 600;

/** Body.circleRadius 与目标 radius 差值超过此阈值时才触发 Body.scale，避免浮点累积 */
const RADIUS_RESCALE_THRESHOLD_PX = 0.5;

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/**
 * 取气泡显示色：anime.color 优先，文字色配套从调色板按 id 取。
 *
 * 文字色：当 anime.color 自定义时无法保证对比度，统一回落到调色板对应槽位
 * 的 text，整体观感仍协调。MVP 不做精确对比度计算。
 */
function pickColors(anime: TrackedAnime): { bg: string; text: string } {
  const palette = pickPaletteColor(anime.id);
  if (anime.color && /^#[0-9a-fA-F]{3,8}$/.test(anime.color)) {
    return { bg: anime.color, text: palette.text };
  }
  return palette;
}

/** 在 [r, dim - r] 内取一个随机坐标（用于新气泡入场位置） */
function randomCoord(dim: number, r: number): number {
  const min = r;
  const max = Math.max(r + 1, dim - r);
  return min + Math.random() * (max - min);
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function BubbleCanvas(props: BubbleCanvasProps): JSX.Element {
  const { animes } = props;

  // —— DOM / 引擎 / 映射的 ref 容器 ——
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const wallsRef = useRef<Matter.Body[]>([]);
  const bodiesRef = useRef<Map<number, Matter.Body>>(new Map());
  const elementsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  /** 每个气泡的最后交互时间（点击/右键），用于 debounce 动画延迟 */
  const lastInteractionRef = useRef<Map<number, number>>(new Map());
  /** 每个气泡当前的锚点 Y（动画的当前位置） */
  const currentAnchorRef = useRef<Map<number, number>>(new Map());
  /** 每个气泡的进行中动画状态：{ 起点 Y, 起点时间, 目标 Y } */
  const animStateRef = useRef<
    Map<number, { startY: number; startTime: number; targetY: number }>
  >(new Map());
  const sizeRef = useRef<{ width: number; height: number }>({
    width: FALLBACK_WIDTH,
    height: FALLBACK_HEIGHT,
  });
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);

  // 让 RAF / 事件回调读到最新的 animes 与 props（避免闭包陷阱）
  const animesRef = useRef<TrackedAnime[]>(animes);
  const propsRef = useRef<BubbleCanvasProps>(props);

  // stalenessTick：每 STALENESS_RERENDER_INTERVAL_MS 触发一次重渲，
  // 让 Bubble 收到的 radius/opacity props 跟随 staleness 缓慢演化。
  const [, setStalenessTick] = useState(0);

  useEffect(() => {
    animesRef.current = animes;
  }, [animes]);

  useEffect(() => {
    propsRef.current = props;
  });

  // —— 单击：在画布层处理冲量，再回传父组件触发 store mutation ——
  const handleBubbleClick = useCallback((animeId: number): void => {
    // 记录交互时间，启动 debounce 计时
    lastInteractionRef.current.set(animeId, Date.now());
    const body = bodiesRef.current.get(animeId);
    if (body) {
      applyClickImpulse(body);
    }
    propsRef.current.onBubbleClick?.(animeId);
  }, []);

  const handleBubbleDoubleClick = useCallback((animeId: number): void => {
    propsRef.current.onBubbleDoubleClick?.(animeId);
  }, []);

  const handleBubbleContextMenu = useCallback(
    (animeId: number, x: number, y: number): void => {
      // 右键也记录交互时间（撤回一集）
      lastInteractionRef.current.set(animeId, Date.now());
      propsRef.current.onBubbleContextMenu?.(animeId, x, y);
    },
    [],
  );

  // -------------------------------------------------------------------------
  // 引擎初始化（mount once）
  //
  // 用 useLayoutEffect 保证在浏览器绘制前完成 engineRef 的初始化，让随后
  // 同步声明的 animes useLayoutEffect 能在第一次提交时就看到 engine。
  // -------------------------------------------------------------------------

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. 创建引擎与初始墙体
    const engine = createEngine();
    engineRef.current = engine;

    // 用容器实际尺寸初始化（若已 layout 完成）
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      sizeRef.current = { width: rect.width, height: rect.height };
    }
    const initialWalls = createWalls(sizeRef.current.width, sizeRef.current.height);
    wallsRef.current = initialWalls;
    Composite.add(engine.world, initialWalls);

    // 2. ResizeObserver：尺寸变化时重建墙体
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const cr = entry.contentRect;
      if (cr.width <= 0 || cr.height <= 0) return;
      if (
        cr.width === sizeRef.current.width &&
        cr.height === sizeRef.current.height
      ) {
        return;
      }
      sizeRef.current = { width: cr.width, height: cr.height };
      // 重建墙体
      if (engineRef.current) {
        Composite.remove(engineRef.current.world, wallsRef.current);
        const walls = createWalls(cr.width, cr.height);
        wallsRef.current = walls;
        Composite.add(engineRef.current.world, walls);
      }
    });
    resizeObserver.observe(container);

    // 3. RAF 主循环
    const tick = (timestamp: number): void => {
      const eng = engineRef.current;
      if (!eng) return;
      const prev = lastFrameRef.current || timestamp;
      const dt = Math.min(timestamp - prev, MAX_FRAME_DT_MS);
      lastFrameRef.current = timestamp;

      const { width, height } = sizeRef.current;
      const now = Date.now();
      const latestAnimes = animesRef.current;

      // 索引一下方便按 id 找：避免每个 body 都遍历列表
      // 量小（< 200）时 O(n) 遍历也行；这里用 Map 减少分配。
      const animeById = new Map<number, TrackedAnime>();
      for (const a of latestAnimes) animeById.set(a.id, a);

      // 位置：基于频率的 staleness 决定目标锚点 Y，叠加 sine 浮动。
      // Debounce 动画：
      //   - 距上次点击/右键 < 0.5s → 锚点保持不动（让用户连点时不会乱跑）
      //   - 距上次点击/右键 ≥ 0.5s → 启动一段 ease-in-out quintic 动画，
      //     模拟气泡在液体中的漂浮感：起步极慢、中段匀速、收尾极慢。
      const FLOAT_AMPLITUDE = 15;
      const FLOAT_PERIOD_MS = 4000;
      const DEBOUNCE_MS = 350;
      const ANIM_DURATION_BASE_MS = 2400; // 短距离动画基础时长（约 2.4 秒）
      const ANIM_DURATION_PER_PX = 3.5; // 距离每多 1px 增加 3.5ms
      const ANIM_DURATION_MAX_MS = 6000; // 上限 6 秒（极长距离）
      const t = now;

      // ease-in-out quintic：比 cubic 更柔软，起步和收尾都接近静止，
      // 中段才到达最大速度。模拟气泡在水中漂浮的感觉。
      const easeInOut = (p: number): number => {
        if (p < 0.5) return 16 * p * p * p * p * p;
        const f = 1 - p;
        return 1 - 16 * f * f * f * f * f;
      };

      bodiesRef.current.forEach((body, animeId) => {
        const anime = animeById.get(animeId);
        if (!anime) return;
        const staleness = computeFrequencyStaleness(now, anime.addedAt, anime.watchedEpisodes, anime.initialWatchedEpisodes ?? 0);
        const r = body.circleRadius ?? 30;

        const minY = r;
        const maxY = height - r;
        const targetAnchorY = minY + staleness * (maxY - minY);

        // 当前锚点：首次为目标位置（直接出现在该位置）
        let currentAnchor = currentAnchorRef.current.get(animeId);
        if (currentAnchor === undefined) {
          currentAnchor = targetAnchorY;
          currentAnchorRef.current.set(animeId, currentAnchor);
        }

        const lastInteraction = lastInteractionRef.current.get(animeId) ?? 0;
        const sinceInteraction = now - lastInteraction;

        if (sinceInteraction < DEBOUNCE_MS) {
          // Debounce 中：取消任何进行中的动画，保持当前位置
          animStateRef.current.delete(animeId);
        } else {
          // 检查是否需要启动新动画
          const anim = animStateRef.current.get(animeId);
          if (anim === undefined) {
            // 没有进行中的动画：如果当前位置 ≠ 目标，启动新动画
            if (Math.abs(currentAnchor - targetAnchorY) > 0.5) {
              const distance = Math.abs(targetAnchorY - currentAnchor);
              const duration = Math.min(
                ANIM_DURATION_BASE_MS + distance * ANIM_DURATION_PER_PX,
                ANIM_DURATION_MAX_MS,
              );
              animStateRef.current.set(animeId, {
                startY: currentAnchor,
                startTime: now,
                targetY: targetAnchorY,
              });
              // 用 duration 隐式存储：通过下次帧推导 progress
              // 把 duration 也存进去
              (animStateRef.current.get(animeId) as { duration?: number }).duration = duration;
            }
          } else {
            // 进行中的动画：如果目标变了（用户在动画中又点了一次后又等了 0.5s），
            // 重新启动以新的当前位置为起点
            if (Math.abs(anim.targetY - targetAnchorY) > 0.5) {
              const distance = Math.abs(targetAnchorY - currentAnchor);
              const duration = Math.min(
                ANIM_DURATION_BASE_MS + distance * ANIM_DURATION_PER_PX,
                ANIM_DURATION_MAX_MS,
              );
              const newAnim = {
                startY: currentAnchor,
                startTime: now,
                targetY: targetAnchorY,
              } as { startY: number; startTime: number; targetY: number; duration?: number };
              newAnim.duration = duration;
              animStateRef.current.set(animeId, newAnim);
            }
          }

          // 推进进行中的动画
          const activeAnim = animStateRef.current.get(animeId) as
            | { startY: number; startTime: number; targetY: number; duration: number }
            | undefined;
          if (activeAnim) {
            const elapsed = now - activeAnim.startTime;
            const progress = Math.min(1, elapsed / activeAnim.duration);
            const eased = easeInOut(progress);
            currentAnchor = activeAnim.startY + (activeAnim.targetY - activeAnim.startY) * eased;
            currentAnchorRef.current.set(animeId, currentAnchor);
            if (progress >= 1) {
              animStateRef.current.delete(animeId);
            }
          }
        }

        const phase = (animeId * 1.7) % (Math.PI * 2);
        // 在最顶部和最底部不浮动（避免被边缘截断）
        const distFromEdge = Math.min(staleness, 1 - staleness); // 0 at edges, 0.5 at center
        const floatScale = Math.min(1, distFromEdge * 5); // 0→0, 0.2→1, 中间全是1
        const floatOffset = Math.sin((t / FLOAT_PERIOD_MS) * Math.PI * 2 + phase) * FLOAT_AMPLITUDE * floatScale;
        const targetY = currentAnchor + floatOffset;

        Body.setPosition(body, { x: body.position.x, y: targetY });
        Body.setVelocity(body, { x: 0, y: 0 });

        resetIfInvalid(body, width, height);
      });

      // 推进物理
      Engine.update(eng, dt);

      // 同步 DOM：transform = translate(x - r, y - r)；通过 CSS 变量更新
      bodiesRef.current.forEach((body, animeId) => {
        const el = elementsRef.current.get(animeId);
        if (!el) return;
        const r = body.circleRadius ?? 0;
        const tx = body.position.x - r;
        const ty = body.position.y - r;
        el.style.setProperty('--bubble-x', `${tx}px`);
        el.style.setProperty('--bubble-y', `${ty}px`);
        // 靠近顶部时 tooltip 显示在下方
        const nearTop = body.position.y < height * 0.2;
        el.classList.toggle('bubble--near-top', nearTop);
      });

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    // 4. stalenessTick 定时器：让视觉 size/opacity 缓慢跟随 staleness
    const stalenessTimer = window.setInterval(() => {
      setStalenessTick((t) => (t + 1) | 0);
    }, STALENESS_RERENDER_INTERVAL_MS);

    return () => {
      // 清理 RAF
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // 清理 ResizeObserver / Interval
      resizeObserver.disconnect();
      window.clearInterval(stalenessTimer);
      // 清理引擎
      if (engineRef.current) {
        Composite.clear(engineRef.current.world, false, true);
        Engine.clear(engineRef.current);
        engineRef.current = null;
      }
      wallsRef.current = [];
      bodiesRef.current.clear();
      elementsRef.current.clear();
      lastFrameRef.current = 0;
    };
    // 仅在 mount 时执行一次；ResizeObserver / RAF / animesRef 让我们不需要依赖项
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // 监听 animes 变化：增 / 删 body & 同步半径
  //
  // 使用 useLayoutEffect 保证在浏览器绘制前完成 body 创建与 CSS 变量同步，
  // 避免新增气泡首帧出现在 (0,0) 再「跳」到正确位置的视觉错位。
  // -------------------------------------------------------------------------

  useLayoutEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const { width, height } = sizeRef.current;
    const now = Date.now();
    const incomingIds = new Set(animes.map((a) => a.id));
    const newlyCreatedIds: number[] = [];

    // 1. 新增：为列表里没有 body 的 anime 创建 body
    for (const anime of animes) {
      if (bodiesRef.current.has(anime.id)) continue;
      const staleness = computeFrequencyStaleness(now, anime.addedAt, anime.watchedEpisodes, anime.initialWatchedEpisodes ?? 0);
      const r = computeBubbleRadius(anime.watchedEpisodes, staleness);
      const x = randomCoord(width, r);
      const y = randomCoord(height, r);
      const body = createBubbleBody(x, y, r);
      Composite.add(engine.world, body);
      bodiesRef.current.set(anime.id, body);
      newlyCreatedIds.push(anime.id);
    }

    // 2. 删除：把不再出现在 animes 中的 body 移除
    const toRemove: number[] = [];
    bodiesRef.current.forEach((_, animeId) => {
      if (!incomingIds.has(animeId)) toRemove.push(animeId);
    });
    for (const animeId of toRemove) {
      const body = bodiesRef.current.get(animeId);
      if (body) {
        Composite.remove(engine.world, body);
      }
      bodiesRef.current.delete(animeId);
      lastInteractionRef.current.delete(animeId);
      currentAnchorRef.current.delete(animeId);
      animStateRef.current.delete(animeId);
    }

    // 3. 半径同步：watched / staleness 变化导致目标 radius 与 body.circleRadius
    //    显著不一致时调用 Body.scale 重新缩放
    for (const anime of animes) {
      const body = bodiesRef.current.get(anime.id);
      if (!body) continue;
      const staleness = computeFrequencyStaleness(now, anime.addedAt, anime.watchedEpisodes, anime.initialWatchedEpisodes ?? 0);
      const targetR = computeBubbleRadius(anime.watchedEpisodes, staleness);
      const currentR = body.circleRadius ?? 0;
      if (currentR > 0 && Math.abs(targetR - currentR) > RADIUS_RESCALE_THRESHOLD_PX) {
        const ratio = targetR / currentR;
        Body.scale(body, ratio, ratio);
      }
    }

    // 4. 新增气泡的位置同步：在浏览器绘制前把 --bubble-x/y 写入对应 DOM
    //    （ref 回调触发时 body 还没创建；这里补一次同步避免首帧 (0,0) 闪烁）
    for (const animeId of newlyCreatedIds) {
      const body = bodiesRef.current.get(animeId);
      const el = elementsRef.current.get(animeId);
      if (!body || !el) continue;
      const r = body.circleRadius ?? 0;
      el.style.setProperty('--bubble-x', `${body.position.x - r}px`);
      el.style.setProperty('--bubble-y', `${body.position.y - r}px`);
    }
  }, [animes]);

  // -------------------------------------------------------------------------
  // 入场动画：每次某只 anime 第一次进入 elementsRef 时挂 .bubble--entering
  // -------------------------------------------------------------------------

  // 已经播放过入场动画的 anime id 集合（避免重渲触发重播）
  const enteredIdsRef = useRef<Set<number>>(new Set());

  // 当前 animes 的 id 集合，用于在 anime 被删除后清理 enteredIds
  const currentIds = useMemo(() => new Set(animes.map((a) => a.id)), [animes]);
  useEffect(() => {
    // 清理已删除的 id，避免长生命周期下 set 一直增大
    enteredIdsRef.current.forEach((id) => {
      if (!currentIds.has(id)) enteredIdsRef.current.delete(id);
    });
  }, [currentIds]);

  /**
   * Bubble 元素的 ref 回调：
   *   - 元素挂载时注册到 elementsRef，并立即把 --bubble-x/y 同步到当前 body 坐标
   *     （避免下一帧 RAF 触发前出现「从 (0,0) 闪现到目标位置」的瞬间错位）。
   *   - 首次挂载时挂 .bubble--entering 类播放入场动画。
   *   - 元素卸载时从 elementsRef 移除。
   */
  const registerBubble = useCallback((animeId: number, el: HTMLDivElement | null) => {
    if (el) {
      elementsRef.current.set(animeId, el);
      // 立即同步到当前刚体位置，避免首帧错位
      const body = bodiesRef.current.get(animeId);
      if (body) {
        const r = body.circleRadius ?? 0;
        el.style.setProperty('--bubble-x', `${body.position.x - r}px`);
        el.style.setProperty('--bubble-y', `${body.position.y - r}px`);
      }
      // 仅首次挂载播一次入场动画
      if (!enteredIdsRef.current.has(animeId)) {
        enteredIdsRef.current.add(animeId);
        el.classList.add(ENTER_CLASS);
        window.setTimeout(() => {
          el.classList.remove(ENTER_CLASS);
        }, ENTER_DURATION_MS);
      }
    } else {
      elementsRef.current.delete(animeId);
    }
  }, []);

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  const now = Date.now();

  return (
    <div ref={containerRef} className="bubble-canvas">
      {animes.length === 0 && (
        <div className="bubble-canvas__empty">
          <p className="bubble-canvas__empty-title">还没有正在看的番</p>
          <p className="bubble-canvas__empty-hint">添加一部番后，它会出现在这里。<br/>点击气泡可以记录一集。</p>
        </div>
      )}
      {animes.map((anime) => {
        const staleness = computeFrequencyStaleness(now, anime.addedAt, anime.watchedEpisodes, anime.initialWatchedEpisodes ?? 0);
        const radius = computeBubbleRadius(anime.watchedEpisodes, staleness);
        const opacity = computeOpacity(staleness);
        const { bg, text } = pickColors(anime);

        return (
          <Bubble
            key={anime.id}
            ref={(el) => registerBubble(anime.id, el)}
            anime={anime}
            radius={radius}
            opacity={opacity}
            bgColor={bg}
            textColor={text}
            isCompleting={props.completingId === anime.id}
            onClick={handleBubbleClick}
            onDoubleClick={handleBubbleDoubleClick}
            onContextMenu={handleBubbleContextMenu}
          />
        );
      })}
    </div>
  );
}

export default BubbleCanvas;
