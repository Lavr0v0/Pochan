/**
 * Bubble 单气泡组件 — 重新设计
 *
 * 视觉：
 *   - 圆形封面（占满气泡）
 *   - 外围环形进度条（SVG stroke）
 *   - 鼠标悬停显示名字 + 进度 tooltip
 *   - 玻璃质感（CSS box-shadow 实现）
 *
 * 交互由父组件 BubbleCanvas 通过 props 回调处理。
 */

import { forwardRef, memo, useCallback, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, TouchEvent } from 'react';

import type { TrackedAnime } from '../types';
import './bubble.css';

export interface BubbleProps {
  anime: TrackedAnime;
  radius: number;
  opacity: number;
  bgColor: string;
  textColor: string;
  onClick?: (animeId: number) => void;
  onDoubleClick?: (animeId: number) => void;
  onContextMenu?: (animeId: number, x: number, y: number) => void;
}

function pickFallbackChar(anime: TrackedAnime): string {
  const source = (anime.nameCn || anime.name || '').trim();
  if (source.length === 0) return '?';
  return Array.from(source)[0] ?? '?';
}

const CLICK_FEEDBACK_MS = 200;
/** 长按阈值（ms）：超过此时间视为右键操作 */
const LONG_PRESS_MS = 500;

const BubbleImpl = forwardRef<HTMLDivElement, BubbleProps>(function Bubble(props, ref) {
  const { anime, radius, opacity, bgColor, textColor } = props;
  const [imgFailed, setImgFailed] = useState(false);
  const activeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);

  const handleImgError = useCallback(() => setImgFailed(true), []);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      // 如果刚触发了长按，忽略这次 click
      if (longPressTriggeredRef.current) {
        longPressTriggeredRef.current = false;
        return;
      }
      const el = event.currentTarget;
      el.classList.add('is-active');
      if (activeTimerRef.current !== null) clearTimeout(activeTimerRef.current);
      activeTimerRef.current = setTimeout(() => {
        el.classList.remove('is-active');
        activeTimerRef.current = null;
      }, CLICK_FEEDBACK_MS);
      props.onClick?.(anime.id);
    },
    [anime.id, props],
  );

  const handleDoubleClick = useCallback(() => {
    props.onDoubleClick?.(anime.id);
  }, [anime.id, props]);

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      props.onContextMenu?.(anime.id, event.clientX, event.clientY);
    },
    [anime.id, props],
  );

  // 长按触摸支持（移动端替代右键）
  const handleTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      longPressTriggeredRef.current = false;
      const touch = event.touches[0];
      if (!touch) return;
      const x = touch.clientX;
      const y = touch.clientY;
      longPressTimerRef.current = setTimeout(() => {
        longPressTriggeredRef.current = true;
        // 触觉反馈（如果浏览器支持）
        if (navigator.vibrate) navigator.vibrate(30);
        props.onContextMenu?.(anime.id, x, y);
      }, LONG_PRESS_MS);
    },
    [anime.id, props],
  );

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchMove = useCallback(() => {
    // 手指移动了，取消长按
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // 环形进度条计算
  const diameter = radius * 2 + 8; // 比气泡大 8px（4px 每边）
  const svgRadius = (diameter - 3) / 2; // stroke-width 3
  const circumference = 2 * Math.PI * svgRadius;
  const total = anime.totalEpisodes > 0 ? anime.totalEpisodes : 1;
  const progress = Math.min(1, anime.watchedEpisodes / total);
  const dashOffset = circumference * (1 - progress);

  const styleVars: CSSProperties = {
    ['--bubble-size' as string]: `${radius * 2}px`,
    ['--bubble-bg' as string]: bgColor,
    ['--bubble-text' as string]: textColor,
    ['--bubble-opacity' as string]: String(opacity),
  };

  const displayName = anime.nameCn || anime.name || '';
  const showFallback = imgFailed || !anime.cover;
  const totalDisplay = anime.totalEpisodes > 0 ? anime.totalEpisodes : '?';

  return (
    <div
      ref={ref}
      className="bubble"
      style={styleVars}
      role="button"
      tabIndex={0}
      aria-label={displayName}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
    >
      {/* 封面 */}
      {showFallback ? (
        <span className="bubble__fallback" aria-hidden="true">
          {pickFallbackChar(anime)}
        </span>
      ) : (
        <img
          className="bubble__cover"
          src={anime.cover}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          onError={handleImgError}
        />
      )}

      {/* 环形进度条 */}
      <svg className="bubble__progress-ring" viewBox={`0 0 ${diameter} ${diameter}`}>
        <circle
          className="bubble__progress-ring-bg"
          cx={diameter / 2}
          cy={diameter / 2}
          r={svgRadius}
        />
        <circle
          className="bubble__progress-ring-fill"
          cx={diameter / 2}
          cy={diameter / 2}
          r={svgRadius}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ stroke: textColor }}
        />
      </svg>

      {/* Hover tooltip */}
      <div className="bubble__tooltip">
        <span className="bubble__tooltip-name">{displayName}</span>
        <span className="bubble__tooltip-progress">
          {anime.watchedEpisodes} / {totalDisplay}
        </span>
        <span className="bubble__tooltip-meta">
          {anime.lastWatchedAt
            ? `上次 ${new Date(anime.lastWatchedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`
            : '尚未记录观看'}
        </span>
      </div>
    </div>
  );
});

export const Bubble = memo(BubbleImpl);
export default Bubble;
