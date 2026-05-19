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
import type { CSSProperties, MouseEvent } from 'react';

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

const BubbleImpl = forwardRef<HTMLDivElement, BubbleProps>(function Bubble(props, ref) {
  const { anime, radius, opacity, bgColor, textColor } = props;
  const [imgFailed, setImgFailed] = useState(false);
  const activeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleImgError = useCallback(() => setImgFailed(true), []);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
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
        {displayName}
        <span className="bubble__tooltip-progress">
          {anime.watchedEpisodes}/{totalDisplay}
        </span>
      </div>
    </div>
  );
});

export const Bubble = memo(BubbleImpl);
export default Bubble;
