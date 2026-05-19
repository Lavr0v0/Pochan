/**
 * CalendarView 日历视图
 *
 * 实现 design.md "Components and Interfaces / CalendarView" 与
 * requirements.md Requirement 4（日历视图）。
 *
 * 视觉布局：
 *   - 顶部 header：← / → 月份导航 + 当前年月显示 + 「今天」按钮（跳回当月）
 *   - 周几标题行：周日 周一 周二 周三 周四 周五 周六（7 列）
 *   - 月历主体：6 行 × 7 列固定网格；前导/后继月日期以 muted 样式显示
 *   - 每个日期格子：
 *       · 顶部数字（如 15）
 *       · 中部 airing 番缩略图列表：所有 airDay 等于该格 day-of-week 的番都展示
 *         （即每个对应周几的所有出现次数都展示）。最多 3 张缩略图，多出显示 +N。
 *       · 底部 goal 番列表：goal.deadline 的「YYYY-MM-DD」与该格匹配的番在此显示，
 *         附 watchedEpisodes / goal.targetEpisodes 进度条。
 *
 * 交互：
 *   - 点击格子内番剧封面 → 打开 AnimeDetailModal（局部 state 维护当前 detailAnimeId）
 *   - 点击格子空白处 → 弹出「快速记录今天看了哪几部」多选弹层；显示全部 anime
 *     （不按日期过滤），用户多选后提交，对每部 incrementWatched(id) 一次。
 *
 * 日期算法：
 *   - 仅使用原生 Date API；不引入第三方库
 *   - airing 落入哪一列：以 cell 的 dayOfWeek（0=周日…6=周六）匹配 anime.airDay
 *   - goal 落入哪一格：以 cell 的本地日期 'YYYY-MM-DD' 与 goal.deadline 切片后的
 *     'YYYY-MM-DD' 比较（按 ISO 字符串前 10 位匹配，避免时区导致漂移）
 *
 * 与 BubbleView 一致的细节：
 *   - 图片设置 referrerPolicy="no-referrer"；onError → 调色板色 + 番名首字
 *   - AnimeDetailModal 通过 anime: TrackedAnime | null 控制开关
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';

import { useAnimeStore } from '../store/useAnimeStore';
import type { TrackedAnime } from '../types';
import { pickPaletteColor } from '../types';
import { AnimeDetailModal } from '../components/AnimeDetailModal';

import './CalendarView.css';

// ---------------------------------------------------------------------------
// 工具：日期 / 字符串
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
const MONTH_LABELS = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
] as const;

/** 把 Date 格式化为本地 'YYYY-MM-DD'，用于和 goal.deadline 切片比对 */
function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 取 ISO 日期字符串的 'YYYY-MM-DD' 部分。
 *
 * goal.deadline 在 design 中规定为 ISO date（要么 'YYYY-MM-DD' 要么完整 ISO 时间戳）；
 * 这里统一切前 10 字符。非合法字符串返回空串以避免误匹配。
 */
function deadlineDateKey(deadline: string): string {
  if (typeof deadline !== 'string' || deadline.length < 10) return '';
  return deadline.slice(0, 10);
}

/** 返回包含 6 行 × 7 列的日历网格起始日期（即网格第一格对应的 Date） */
function gridStartDate(year: number, month: number): Date {
  // month 入参基于 0-11
  const first = new Date(year, month, 1);
  const dayOfWeek = first.getDay(); // 0 = Sunday
  const start = new Date(year, month, 1 - dayOfWeek);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** 取番剧首字（中文优先），与 Bubble / AnimeDetailModal 保持一致 */
function pickFallbackChar(anime: TrackedAnime): string {
  const source = (anime.nameCn || anime.name || '').trim();
  if (source.length === 0) return '?';
  return Array.from(source)[0] ?? '?';
}

/** 单个日历格子的派生数据 */
interface CalendarCell {
  /** 日期对象（本地） */
  date: Date;
  /** 'YYYY-MM-DD' */
  dateKey: string;
  /** 0-6，周日到周六 */
  dayOfWeek: number;
  /** 是否属于当前显示的月份（不属于则使用 muted 样式） */
  inCurrentMonth: boolean;
  /** 是否是今天 */
  isToday: boolean;
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export function CalendarView(): JSX.Element {
  const animes = useAnimeStore((s) => s.animes);
  const incrementWatched = useAnimeStore((s) => s.incrementWatched);

  // —— 当前显示的年月 ——
  const [cursor, setCursor] = useState<{ year: number; month: number }>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // —— 详情 modal ——
  const [detailAnimeId, setDetailAnimeId] = useState<number | null>(null);

  // —— 快速记录弹层：null 表示未打开；string 为 'YYYY-MM-DD'（用户点击的格子日期） ——
  const [quickWatchDateKey, setQuickWatchDateKey] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // 派生数据
  // -------------------------------------------------------------------------

  /** 生成当前 cursor 月份的 6×7 网格 */
  const cells = useMemo<CalendarCell[]>(() => {
    const start = gridStartDate(cursor.year, cursor.month);
    const todayKey = toLocalDateKey(new Date());
    const result: CalendarCell[] = [];
    for (let i = 0; i < 42; i += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const dateKey = toLocalDateKey(date);
      result.push({
        date,
        dateKey,
        dayOfWeek: date.getDay(),
        inCurrentMonth: date.getMonth() === cursor.month,
        isToday: dateKey === todayKey,
      });
    }
    return result;
  }, [cursor.year, cursor.month]);

  /**
   * airing 番按 airDay 分组（airDay ∈ [0, 6]）。
   *
   * 顺序保留 store 中的添加顺序，保证渲染稳定性。
   * 没有 airDay 的 airing 番不出现在更新日列中（与 Property 22 一致）。
   */
  const airingByDay = useMemo<TrackedAnime[][]>(() => {
    const buckets: TrackedAnime[][] = [[], [], [], [], [], [], []];
    for (const a of animes) {
      if (a.status !== 'airing') continue;
      if (typeof a.airDay !== 'number') continue;
      if (a.airDay < 0 || a.airDay > 6) continue;
      buckets[a.airDay]!.push(a);
    }
    return buckets;
  }, [animes]);

  /** goal 番按 deadline 的 'YYYY-MM-DD' 分桶 */
  const goalByDate = useMemo<Map<string, TrackedAnime[]>>(() => {
    const map = new Map<string, TrackedAnime[]>();
    for (const a of animes) {
      if (!a.goal) continue;
      const key = deadlineDateKey(a.goal.deadline);
      if (key.length === 0) continue;
      const list = map.get(key);
      if (list) list.push(a);
      else map.set(key, [a]);
    }
    return map;
  }, [animes]);

  /** 详情 modal 的当前 anime（id 找不到时回退 null） */
  const detailAnime = useMemo<TrackedAnime | null>(() => {
    if (detailAnimeId === null) return null;
    return animes.find((a) => a.id === detailAnimeId) ?? null;
  }, [animes, detailAnimeId]);

  // -------------------------------------------------------------------------
  // 月份导航
  // -------------------------------------------------------------------------

  const handlePrevMonth = useCallback(() => {
    setCursor((prev) => {
      const next = new Date(prev.year, prev.month - 1, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }, []);

  const handleNextMonth = useCallback(() => {
    setCursor((prev) => {
      const next = new Date(prev.year, prev.month + 1, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }, []);

  const handleJumpToday = useCallback(() => {
    const now = new Date();
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
  }, []);

  // -------------------------------------------------------------------------
  // 单格交互
  // -------------------------------------------------------------------------

  const handleAnimeClick = useCallback((animeId: number) => {
    setDetailAnimeId(animeId);
  }, []);

  const handleCellEmptyClick = useCallback((dateKey: string) => {
    setQuickWatchDateKey(dateKey);
  }, []);

  const handleQuickWatchClose = useCallback(() => {
    setQuickWatchDateKey(null);
  }, []);

  const handleQuickWatchSubmit = useCallback(
    (selectedIds: number[]) => {
      for (const id of selectedIds) {
        incrementWatched(id);
      }
      setQuickWatchDateKey(null);
    },
    [incrementWatched],
  );

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  const headerLabel = `${cursor.year} 年 ${MONTH_LABELS[cursor.month]}`;

  return (
    <div className="calendar-view">
      <header className="calendar-view__header">
        <div className="calendar-view__nav">
          <button
            type="button"
            className="calendar-view__nav-button"
            aria-label="上个月"
            onClick={handlePrevMonth}
          >
            ←
          </button>
          <h2 className="calendar-view__title">{headerLabel}</h2>
          <button
            type="button"
            className="calendar-view__nav-button"
            aria-label="下个月"
            onClick={handleNextMonth}
          >
            →
          </button>
        </div>
        <button
          type="button"
          className="calendar-view__today-button"
          onClick={handleJumpToday}
        >
          今天
        </button>
      </header>

      <div className="calendar-view__weekdays" role="row">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="calendar-view__weekday"
            role="columnheader"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="calendar-view__grid" role="grid">
        {cells.map((cell) => {
          const airingList = airingByDay[cell.dayOfWeek] ?? [];
          const goalList = goalByDate.get(cell.dateKey) ?? [];
          return (
            <CalendarCellView
              key={cell.dateKey}
              cell={cell}
              airing={airingList}
              goals={goalList}
              onAnimeClick={handleAnimeClick}
              onEmptyClick={handleCellEmptyClick}
            />
          );
        })}
      </div>

      {quickWatchDateKey !== null && (
        <QuickWatchDialog
          dateKey={quickWatchDateKey}
          animes={animes}
          onClose={handleQuickWatchClose}
          onSubmit={handleQuickWatchSubmit}
        />
      )}

      <AnimeDetailModal
        anime={detailAnime}
        onClose={() => setDetailAnimeId(null)}
      />
    </div>
  );
}

export default CalendarView;

// ---------------------------------------------------------------------------
// 子组件：单个日历格子
// ---------------------------------------------------------------------------

interface CalendarCellViewProps {
  cell: CalendarCell;
  airing: TrackedAnime[];
  goals: TrackedAnime[];
  onAnimeClick: (animeId: number) => void;
  onEmptyClick: (dateKey: string) => void;
}

/** 单格内最多展示的 airing 缩略图数量；超出折叠为 +N */
const MAX_VISIBLE_AIRING = 3;

function CalendarCellView(props: CalendarCellViewProps): JSX.Element {
  const { cell, airing, goals, onAnimeClick, onEmptyClick } = props;

  const visibleAiring = airing.slice(0, MAX_VISIBLE_AIRING);
  const overflowCount = airing.length - visibleAiring.length;

  /**
   * 点击格子背景 → 弹出快速记录对话框；点击格子内番剧封面 / +N 等需阻止冒泡。
   */
  const handleBackgroundClick = (): void => {
    onEmptyClick(cell.dateKey);
  };

  const dayNumber = cell.date.getDate();

  return (
    <div
      className={
        'calendar-view__cell' +
        (cell.inCurrentMonth ? '' : ' calendar-view__cell--out') +
        (cell.isToday ? ' calendar-view__cell--today' : '')
      }
      role="gridcell"
      onClick={handleBackgroundClick}
    >
      <div className="calendar-view__cell-day">{dayNumber}</div>

      {visibleAiring.length > 0 && (
        <div className="calendar-view__airing-row">
          {visibleAiring.map((anime) => (
            <AnimeThumbnail
              key={anime.id}
              anime={anime}
              onClick={onAnimeClick}
            />
          ))}
          {overflowCount > 0 && (
            <span
              className="calendar-view__airing-overflow"
              onClick={(e) => e.stopPropagation()}
              aria-label={`还有 ${overflowCount} 部`}
            >
              +{overflowCount}
            </span>
          )}
        </div>
      )}

      {goals.length > 0 && (
        <ul className="calendar-view__goal-list">
          {goals.map((anime) => (
            <li key={anime.id}>
              <GoalRow anime={anime} onClick={onAnimeClick} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子组件：airing 番缩略图（小尺寸；onError 回退）
// ---------------------------------------------------------------------------

interface AnimeThumbnailProps {
  anime: TrackedAnime;
  onClick: (animeId: number) => void;
}

function AnimeThumbnail(props: AnimeThumbnailProps): JSX.Element {
  const { anime, onClick } = props;
  const [failed, setFailed] = useState(false);

  // anime.cover 变化时复位失败状态
  useEffect(() => {
    setFailed(false);
  }, [anime.cover]);

  const palette = pickPaletteColor(anime.id);
  const showFallback = failed || !anime.cover;
  const displayName = anime.nameCn || anime.name || '';

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    onClick(anime.id);
  };

  return (
    <button
      type="button"
      className="calendar-view__thumb"
      title={displayName}
      onClick={handleClick}
      aria-label={displayName}
    >
      {showFallback ? (
        <span
          className="calendar-view__thumb-fallback"
          style={{ backgroundColor: palette.bg, color: palette.text }}
          aria-hidden="true"
        >
          {pickFallbackChar(anime)}
        </span>
      ) : (
        <img
          className="calendar-view__thumb-img"
          src={anime.cover}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 子组件：含目标的番剧行（封面 + 名字 + 进度条）
// ---------------------------------------------------------------------------

interface GoalRowProps {
  anime: TrackedAnime;
  onClick: (animeId: number) => void;
}

function GoalRow(props: GoalRowProps): JSX.Element {
  const { anime, onClick } = props;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [anime.cover]);

  const goal = anime.goal;
  // GoalRow 仅在 anime.goal 存在时才会被渲染；这里再做一次防御。
  const target = goal ? Math.max(1, goal.targetEpisodes) : 1;
  const progress = Math.min(1, anime.watchedEpisodes / target);
  const palette = pickPaletteColor(anime.id);
  const showFallback = failed || !anime.cover;
  const displayName = anime.nameCn || anime.name || '';

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    onClick(anime.id);
  };

  return (
    <button
      type="button"
      className="calendar-view__goal-row"
      onClick={handleClick}
      aria-label={`${displayName} 目标进度`}
    >
      {showFallback ? (
        <span
          className="calendar-view__goal-cover calendar-view__goal-cover--fallback"
          style={{ backgroundColor: palette.bg, color: palette.text }}
          aria-hidden="true"
        >
          {pickFallbackChar(anime)}
        </span>
      ) : (
        <img
          className="calendar-view__goal-cover"
          src={anime.cover}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
      <div className="calendar-view__goal-meta">
        <span className="calendar-view__goal-name">{displayName}</span>
        <div className="calendar-view__goal-progress" aria-hidden="true">
          <span
            className="calendar-view__goal-progress-fill"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <span className="calendar-view__goal-count">
          {anime.watchedEpisodes} / {goal ? goal.targetEpisodes : '?'}
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// 子组件：快速记录对话框
//
// 显示当前所有 anime（不按日期过滤；用户可挑选今天看了的任意番剧）。
// 多选 + 提交：对每部所选 anime 调用 incrementWatched。
// ---------------------------------------------------------------------------

interface QuickWatchDialogProps {
  dateKey: string;
  animes: TrackedAnime[];
  onClose: () => void;
  onSubmit: (selectedIds: number[]) => void;
}

function QuickWatchDialog(props: QuickWatchDialogProps): JSX.Element {
  const { dateKey, animes, onClose, onSubmit } = props;
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const toggle = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCheckboxChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const id = Number(e.target.value);
    if (Number.isFinite(id)) toggle(id);
  };

  const handleSubmit = (): void => {
    onSubmit(Array.from(selected));
  };

  const stopPropagation = (e: React.MouseEvent): void => {
    e.stopPropagation();
  };

  // 标题日期格式化（'YYYY-MM-DD' → 'YYYY 年 M 月 D 日'）
  const titleLabel = formatDateKey(dateKey);

  return (
    <div
      className="calendar-view__quick-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="快速记录"
      onClick={onClose}
    >
      <div
        className="calendar-view__quick-card"
        onClick={stopPropagation}
        onMouseDown={stopPropagation}
      >
        <header className="calendar-view__quick-header">
          <h3 className="calendar-view__quick-title">
            {titleLabel} 看了哪几部？
          </h3>
          <p className="calendar-view__quick-hint">
            勾选后点击「记录」会把所选番剧的已看集数 +1。
          </p>
        </header>

        <ul className="calendar-view__quick-list">
          {animes.length === 0 && (
            <li className="calendar-view__quick-empty">
              还没有追番。先去添加一部吧。
            </li>
          )}
          {animes.map((anime) => {
            const checked = selected.has(anime.id);
            const displayName = anime.nameCn || anime.name || '(未命名)';
            return (
              <li key={anime.id}>
                <label className="calendar-view__quick-item">
                  <input
                    type="checkbox"
                    value={anime.id}
                    checked={checked}
                    onChange={handleCheckboxChange}
                  />
                  <span className="calendar-view__quick-item-name">
                    {displayName}
                  </span>
                  <span className="calendar-view__quick-item-progress">
                    {anime.watchedEpisodes} /{' '}
                    {anime.totalEpisodes > 0 ? anime.totalEpisodes : '?'}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <footer className="calendar-view__quick-footer">
          <button
            type="button"
            className="calendar-view__quick-cancel"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="calendar-view__quick-submit"
            onClick={handleSubmit}
            disabled={selected.size === 0}
          >
            记录（{selected.size}）
          </button>
        </footer>
      </div>
    </div>
  );
}

/** 把 'YYYY-MM-DD' 格式化为 'YYYY 年 M 月 D 日'，解析失败时回退原值 */
function formatDateKey(key: string): string {
  if (key.length < 10) return key;
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return key;
  }
  return `${year} 年 ${month} 月 ${day} 日`;
}
