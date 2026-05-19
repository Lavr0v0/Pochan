/**
 * LibraryView 番剧库视图
 *
 * 实现 design.md "Components and Interfaces / LibraryView" 与 requirements.md
 * Requirement 5（番剧库视图）。
 *
 * 职责：
 *   1. 默认表格布局；提供「表格 / 卡片」切换控件。
 *   2. 表格列：复选框、封面、名字、watchedEpisodes / totalEpisodes、
 *      上次观看时间、类型、操作（查看详情）。
 *   3. 卡片布局：固定 200×280 网格卡片，显示封面、名字、进度、状态徽章；
 *      点击卡片打开 AnimeDetailModal。
 *   4. 排序键：name | lastWatchedAt | progress | addedAt（升序 / 降序切换）。
 *   5. 状态筛选：all | airing | finished。
 *   6. 多行勾选 + 批量删除（调用 useAnimeStore.removeMany）。
 *   7. 多行勾选 + 批量改类型（对每个 ID 调用 useAnimeStore.updateAnime）。
 *   8. 双击 / 「查看详情」按钮 / 卡片点击 → 打开 AnimeDetailModal。
 *
 * 排序细节（详见 Property 10：「permutation + 非降序」）：
 *   - name：按 (nameCn || name) 进行 zh-CN locale compare
 *   - lastWatchedAt：按 Date.parse 后的毫秒数；解析失败视为 0
 *   - progress：watchedEpisodes / max(totalEpisodes, 1) 的比值
 *   - addedAt：按 Date.parse 后的毫秒数；解析失败视为 0
 *   - 任何键的 tie-break 都使用 id 升序，保证稳定且可重现
 *   - 升降序：sortDir === 'asc' 为非降，'desc' 为非升
 *
 * 筛选细节（详见 Property 11）：
 *   - filterStatus === 'all'：返回原列表（保持原顺序）
 *   - 其余：filter(a => a.status === filterStatus)
 *
 * 选中态约束：
 *   - 列表（animes）变化（删除 / 状态修改）后，selectedIds 中已不存在的 id 自动剔除
 *   - 「全选」按钮仅作用于「当前可见行」（即排序 + 筛选后的视图行）
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ChangeEvent } from 'react';

import { useAnimeStore } from '../store/useAnimeStore';
import type { TrackedAnime } from '../types';
import { pickPaletteColor } from '../types';
import { AnimeDetailModal } from '../components/AnimeDetailModal';

import './LibraryView.css';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type LayoutMode = 'table' | 'card';
export type SortKey = 'name' | 'lastWatchedAt' | 'progress' | 'addedAt';
export type SortDir = 'asc' | 'desc';
/** 按追番阶段筛选 */
export type FilterWatchStatus = 'all' | 'plan' | 'watching' | 'completed' | 'dropped';

interface SortKeyOption {
  key: SortKey;
  label: string;
}

const SORT_OPTIONS: readonly SortKeyOption[] = [
  { key: 'lastWatchedAt', label: '上次观看' },
  { key: 'name', label: '名字' },
  { key: 'progress', label: '完成度' },
  { key: 'addedAt', label: '添加时间' },
] as const;

interface FilterOption {
  value: FilterWatchStatus;
  label: string;
}

const FILTER_OPTIONS: readonly FilterOption[] = [
  { value: 'all', label: '全部' },
  { value: 'watching', label: '在看' },
  { value: 'plan', label: '想看' },
  { value: 'completed', label: '看完' },
  { value: 'dropped', label: '弃番' },
] as const;

/** 把 watchStatus 转成中文 label（显示用） */
const WATCH_STATUS_LABEL: Record<'plan' | 'watching' | 'completed' | 'dropped', string> = {
  plan: '想看',
  watching: '在看',
  completed: '看完',
  dropped: '弃番',
};

/** 播出状态中文 */
const AIR_STATUS_LABEL: Record<'airing' | 'finished' | 'upcoming', string> = {
  airing: '连载中',
  finished: '已完结',
  upcoming: '未播出',
};

/** 兼容旧数据：未设置 watchStatus 时视为 'watching' */
function getWatchStatus(a: TrackedAnime): 'plan' | 'watching' | 'completed' | 'dropped' {
  return a.watchStatus ?? 'watching';
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 取主名（中文优先），用于排序与展示 */
function pickPrimaryName(a: TrackedAnime): string {
  return a.nameCn || a.name || '';
}

/** 取番名首字作为封面回退占位 */
function pickFallbackChar(a: TrackedAnime): string {
  const source = pickPrimaryName(a).trim();
  if (source.length === 0) return '?';
  return Array.from(source)[0] ?? '?';
}

/** Date.parse 包装；解析失败返回 0，方便排序 */
function parseTime(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** 完成度比值；total 为 0 时按最大集数 1 兜底，避免 NaN */
function progressRatio(a: TrackedAnime): number {
  const total = a.totalEpisodes > 0 ? a.totalEpisodes : 1;
  return a.watchedEpisodes / total;
}

/** 用 zh-CN locale 格式化 ISO 时间戳；解析失败回退原文 */
function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  return new Date(ts).toLocaleString('zh-CN');
}

/**
 * 比较两个 anime 在指定排序键下的相对顺序。
 *
 * 返回 < 0：a 在前；> 0：a 在后；0：tie。
 * tie 时由调用方追加 id 升序作为稳定的二级排序。
 */
function compareByKey(a: TrackedAnime, b: TrackedAnime, key: SortKey): number {
  switch (key) {
    case 'name': {
      const an = pickPrimaryName(a);
      const bn = pickPrimaryName(b);
      return an.localeCompare(bn, 'zh-CN');
    }
    case 'lastWatchedAt':
      return parseTime(a.lastWatchedAt) - parseTime(b.lastWatchedAt);
    case 'progress':
      return progressRatio(a) - progressRatio(b);
    case 'addedAt':
      return parseTime(a.addedAt) - parseTime(b.addedAt);
    default: {
      // 穷尽检查
      const _exhaustive: never = key;
      void _exhaustive;
      return 0;
    }
  }
}

/**
 * 排序：先按指定键比较，tie 时按 id 升序。
 *
 * 性质（Property 10）：结果是输入的 permutation；按 sortKey 非降（asc）或非升（desc）。
 */
export function sortAnimes(
  list: readonly TrackedAnime[],
  key: SortKey,
  dir: SortDir,
): TrackedAnime[] {
  const factor = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const primary = compareByKey(a, b, key);
    if (primary !== 0) return factor * primary;
    // tie-break: 始终用 id 升序，保证可重现
    return a.id - b.id;
  });
}

/**
 * 筛选。
 *
 * 性质（Property 11）：
 *   - filter === 'all'：返回原引用（不复制）
 *   - 否则：保留 status === filter 的项，原顺序
 */
export function filterAnimes(
  list: readonly TrackedAnime[],
  filter: FilterWatchStatus,
): readonly TrackedAnime[] {
  if (filter === 'all') return list;
  return list.filter((a) => getWatchStatus(a) === filter);
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function LibraryView(): JSX.Element {
  // —— store 选择 ——
  const animes = useAnimeStore((s) => s.animes);
  const removeMany = useAnimeStore((s) => s.removeMany);
  const updateAnime = useAnimeStore((s) => s.updateAnime);

  // —— 视图本地状态 ——
  const [layout, setLayout] = useState<LayoutMode>('card');
  const [sortKey, setSortKey] = useState<SortKey>('lastWatchedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterStatus, setFilterStatus] = useState<FilterWatchStatus>('all');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [detailAnimeId, setDetailAnimeId] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<boolean>(false);
  const [searchText, setSearchText] = useState<string>('');

  // -------------------------------------------------------------------------
  // 派生数据：先筛选后排序
  // -------------------------------------------------------------------------

  const visibleAnimes = useMemo<TrackedAnime[]>(() => {
    let list = filterAnimes(animes, filterStatus) as TrackedAnime[];
    // 搜索过滤
    const keyword = searchText.trim().toLowerCase();
    if (keyword.length > 0) {
      list = list.filter((a) => {
        const name = (a.name || '').toLowerCase();
        const nameCn = (a.nameCn || '').toLowerCase();
        return name.includes(keyword) || nameCn.includes(keyword);
      });
    }
    return sortAnimes(list, sortKey, sortDir);
  }, [animes, filterStatus, sortKey, sortDir, searchText]);

  const visibleIds = useMemo<number[]>(
    () => visibleAnimes.map((a) => a.id),
    [visibleAnimes],
  );

  // -------------------------------------------------------------------------
  // selectedIds 一致性维护：列表删除 / 筛选改变后剔除已不可见的 id
  // -------------------------------------------------------------------------

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(visibleIds);
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (visible.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [visibleIds]);

  // -------------------------------------------------------------------------
  // 详情 modal 当前展示的 anime
  // -------------------------------------------------------------------------

  const detailAnime = useMemo<TrackedAnime | null>(() => {
    if (detailAnimeId === null) return null;
    return animes.find((a) => a.id === detailAnimeId) ?? null;
  }, [animes, detailAnimeId]);

  // -------------------------------------------------------------------------
  // 选择交互
  // -------------------------------------------------------------------------

  const allVisibleSelected =
    visibleIds.length > 0 && selectedIds.size === visibleIds.length &&
    visibleIds.every((id) => selectedIds.has(id));

  /** 切换某行的勾选 */
  const toggleRow = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** 表头复选框：在「全选可见」与「全部清空」之间切换 */
  const toggleSelectAllVisible = useCallback(() => {
    if (visibleIds.length === 0) return;
    setSelectedIds((prev) => {
      const allSelected =
        prev.size === visibleIds.length &&
        visibleIds.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(visibleIds);
    });
  }, [visibleIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // -------------------------------------------------------------------------
  // 批量操作
  // -------------------------------------------------------------------------

  const handleRequestBulkDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    setConfirmingDelete(true);
  }, [selectedIds.size]);

  const handleCancelBulkDelete = useCallback(() => {
    setConfirmingDelete(false);
  }, []);

  const handleConfirmBulkDelete = useCallback(() => {
    if (selectedIds.size === 0) {
      setConfirmingDelete(false);
      return;
    }
    removeMany(Array.from(selectedIds));
    setSelectedIds(new Set());
    setConfirmingDelete(false);
  }, [removeMany, selectedIds]);

  /**
   * 批量改类型：对每个所选 id 调用 updateAnime。
   *
   * 选择「逐个 updateAnime」而非新增 updateMany，是为了避免改动 store 接口；
   * 每次调用都是 O(n) 的 map 复制，合计 O(k·n) 但 k 通常较小，可接受。
   * 若未来出现批量场景的性能问题，再向 store 加 updateMany。
   */
  const handleBulkChangeStatus = useCallback(
    (target: 'plan' | 'watching' | 'completed' | 'dropped') => {
      if (selectedIds.size === 0) return;
      for (const id of selectedIds) {
        updateAnime(id, { watchStatus: target });
      }
    },
    [selectedIds, updateAnime],
  );

  // -------------------------------------------------------------------------
  // 控件回调
  // -------------------------------------------------------------------------

  const handleSortKeyChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setSortKey(e.target.value as SortKey);
  }, []);

  const toggleSortDir = useCallback(() => {
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
  }, []);

  const handleFilterChange = useCallback(
    (value: FilterWatchStatus) => {
      setFilterStatus(value);
    },
    [],
  );

  const handleOpenDetail = useCallback((id: number) => {
    setDetailAnimeId(id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailAnimeId(null);
  }, []);

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  const selectionCount = selectedIds.size;
  const showBulkBar = selectionCount > 0;

  return (
    <div className="library-view">
      <div className="library-view__toolbar">
        <div className="library-view__toolbar-group">
          <span className="library-view__toolbar-label">布局</span>
          <div
            className="library-view__segmented"
            role="radiogroup"
            aria-label="布局切换"
          >
            <button
              type="button"
              role="radio"
              aria-checked={layout === 'table'}
              className={
                'library-view__segmented-button' +
                (layout === 'table' ? ' library-view__segmented-button--active' : '')
              }
              onClick={() => setLayout('table')}
            >
              表格
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={layout === 'card'}
              className={
                'library-view__segmented-button' +
                (layout === 'card' ? ' library-view__segmented-button--active' : '')
              }
              onClick={() => setLayout('card')}
            >
              卡片
            </button>
          </div>
        </div>

        <div className="library-view__toolbar-group">
          <label
            className="library-view__toolbar-label"
            htmlFor="library-view-sort-key"
          >
            排序
          </label>
          <select
            id="library-view-sort-key"
            className="library-view__select"
            value={sortKey}
            onChange={handleSortKeyChange}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="library-view__icon-button"
            onClick={toggleSortDir}
            aria-label={sortDir === 'asc' ? '升序，点击切换为降序' : '降序，点击切换为升序'}
            title={sortDir === 'asc' ? '升序' : '降序'}
          >
            {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>

        <div className="library-view__toolbar-spacer" />

        {/* 滑块 pill 筛选 */}
        <div className="library-view__pill-tabs" role="tablist">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              role="tab"
              aria-selected={filterStatus === opt.value}
              className={
                'library-view__pill' +
                (filterStatus === opt.value ? ' library-view__pill--active' : '')
              }
              onClick={() => handleFilterChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          className="library-view__search"
          placeholder="搜索番剧库"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          aria-label="搜索番剧库"
        />

        <span className="library-view__count">{visibleAnimes.length} 部</span>
      </div>

      {showBulkBar && (
        <div className="library-view__bulk-bar" role="region" aria-label="批量操作">
          {!confirmingDelete ? (
            <>
              <span className="library-view__bulk-count">
                已选 {selectionCount} 部
              </span>
              <div className="library-view__bulk-actions">
                <button
                  type="button"
                  className="library-view__bulk-button"
                  onClick={() => handleBulkChangeStatus('watching')}
                >
                  设为在看
                </button>
                <button
                  type="button"
                  className="library-view__bulk-button"
                  onClick={() => handleBulkChangeStatus('plan')}
                >
                  设为想看
                </button>
                <button
                  type="button"
                  className="library-view__bulk-button"
                  onClick={() => handleBulkChangeStatus('completed')}
                >
                  设为看完
                </button>
                <button
                  type="button"
                  className="library-view__bulk-button"
                  onClick={() => handleBulkChangeStatus('dropped')}
                >
                  设为弃番
                </button>
                <button
                  type="button"
                  className="library-view__bulk-button library-view__bulk-button--danger"
                  onClick={handleRequestBulkDelete}
                >
                  批量删除
                </button>
                <button
                  type="button"
                  className="library-view__bulk-button"
                  onClick={clearSelection}
                >
                  取消选择
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="library-view__bulk-count">
                确定删除 {selectionCount} 部番剧？
              </span>
              <div className="library-view__bulk-actions">
                <button
                  type="button"
                  className="library-view__bulk-button"
                  onClick={handleCancelBulkDelete}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="library-view__bulk-button library-view__bulk-button--danger-confirm"
                  onClick={handleConfirmBulkDelete}
                  autoFocus
                >
                  确认删除
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="library-view__body">
        {visibleAnimes.length === 0 ? (
          <div className="library-view__empty">
            {animes.length === 0
              ? '尚未追任何番剧。在气泡视图点击「+ 添加番剧」开始追番吧。'
              : '没有匹配当前筛选的番剧。'}
          </div>
        ) : layout === 'table' ? (
          <LibraryTable
            animes={visibleAnimes}
            selectedIds={selectedIds}
            allSelected={allVisibleSelected}
            onToggleRow={toggleRow}
            onToggleAll={toggleSelectAllVisible}
            onOpenDetail={handleOpenDetail}
          />
        ) : (
          <LibraryCardGrid
            animes={visibleAnimes}
            selectedIds={selectedIds}
            onToggleRow={toggleRow}
            onOpenDetail={handleOpenDetail}
          />
        )}
      </div>

      <AnimeDetailModal anime={detailAnime} onClose={handleCloseDetail} />
    </div>
  );
}

export default LibraryView;

// ---------------------------------------------------------------------------
// 表格布局
// ---------------------------------------------------------------------------

interface LibraryTableProps {
  animes: TrackedAnime[];
  selectedIds: Set<number>;
  allSelected: boolean;
  onToggleRow: (id: number) => void;
  onToggleAll: () => void;
  onOpenDetail: (id: number) => void;
}

function LibraryTable(props: LibraryTableProps): JSX.Element {
  const { animes, selectedIds, allSelected, onToggleRow, onToggleAll, onOpenDetail } =
    props;

  return (
    <div className="library-view__table-wrap">
      <table className="library-view__table">
        <thead>
          <tr>
            <th className="library-view__col-check">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label="全选可见行"
              />
            </th>
            <th className="library-view__col-cover">封面</th>
            <th className="library-view__col-name">名字</th>
            <th className="library-view__col-progress">进度</th>
            <th className="library-view__col-time">上次观看</th>
            <th className="library-view__col-status">类型</th>
            <th className="library-view__col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          {animes.map((a) => (
            <LibraryRow
              key={a.id}
              anime={a}
              checked={selectedIds.has(a.id)}
              onToggle={onToggleRow}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface LibraryRowProps {
  anime: TrackedAnime;
  checked: boolean;
  onToggle: (id: number) => void;
  onOpenDetail: (id: number) => void;
}

function LibraryRow(props: LibraryRowProps): JSX.Element {
  const { anime, checked, onToggle, onOpenDetail } = props;
  const totalDisplay = anime.totalEpisodes > 0 ? anime.totalEpisodes : '?';
  const subName = anime.nameCn && anime.name && anime.name !== anime.nameCn
    ? anime.name
    : '';
  const ratio = Math.min(1, Math.max(0, progressRatio(anime)));
  const ratioPercent = Math.round(ratio * 100);

  return (
    <tr
      className={
        'library-view__row' +
        (checked ? ' library-view__row--selected' : '')
      }
      onDoubleClick={() => onOpenDetail(anime.id)}
    >
      <td className="library-view__col-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(anime.id)}
          aria-label={`选择 ${pickPrimaryName(anime)}`}
        />
      </td>
      <td className="library-view__col-cover">
        <RowCover anime={anime} />
      </td>
      <td className="library-view__col-name">
        <div className="library-view__name-primary">{pickPrimaryName(anime) || '(未命名)'}</div>
        {subName && (
          <div className="library-view__name-secondary">{subName}</div>
        )}
      </td>
      <td className="library-view__col-progress">
        <div className="library-view__progress-text">
          {anime.watchedEpisodes} / {totalDisplay}
        </div>
        <div
          className="library-view__progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={ratioPercent}
        >
          <div
            className="library-view__progress-bar-fill"
            style={{ width: `${ratioPercent}%` }}
          />
        </div>
      </td>
      <td className="library-view__col-time">
        {formatDateTime(anime.lastWatchedAt)}
      </td>
      <td className="library-view__col-status">
        <span
          className={
            'library-view__status-badge library-view__status-badge--' +
            getWatchStatus(anime)
          }
        >
          {WATCH_STATUS_LABEL[getWatchStatus(anime)]}
        </span>
      </td>
      <td className="library-view__col-actions">
        <button
          type="button"
          className="library-view__action-button"
          onClick={() => onOpenDetail(anime.id)}
        >
          查看详情
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// 卡片布局
// ---------------------------------------------------------------------------

interface LibraryCardGridProps {
  animes: TrackedAnime[];
  selectedIds: Set<number>;
  onToggleRow: (id: number) => void;
  onOpenDetail: (id: number) => void;
}

function LibraryCardGrid(props: LibraryCardGridProps): JSX.Element {
  const { animes, selectedIds, onToggleRow, onOpenDetail } = props;
  return (
    <div className="library-view__card-grid">
      {animes.map((a) => (
        <LibraryCard
          key={a.id}
          anime={a}
          checked={selectedIds.has(a.id)}
          onToggle={onToggleRow}
          onOpenDetail={onOpenDetail}
        />
      ))}
    </div>
  );
}

interface LibraryCardProps {
  anime: TrackedAnime;
  checked: boolean;
  onToggle: (id: number) => void;
  onOpenDetail: (id: number) => void;
}

function LibraryCard(props: LibraryCardProps): JSX.Element {
  const { anime, checked, onToggle, onOpenDetail } = props;
  const totalDisplay = anime.totalEpisodes > 0 ? anime.totalEpisodes : '?';
  const ratio = Math.min(1, Math.max(0, progressRatio(anime)));
  const ratioPercent = Math.round(ratio * 100);

  return (
    <div
      className={
        'library-view__card' +
        (checked ? ' library-view__card--selected' : '')
      }
    >
      {/* 复选框：阻止冒泡到卡片 click，避免勾选时同时打开详情 */}
      <label
        className="library-view__card-check"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(anime.id)}
          aria-label={`选择 ${pickPrimaryName(anime)}`}
        />
      </label>

      <button
        type="button"
        className="library-view__card-body"
        onClick={() => onOpenDetail(anime.id)}
      >
        <CardCover anime={anime} />
        <div className="library-view__card-info">
          <div className="library-view__card-name">
            {pickPrimaryName(anime) || '(未命名)'}
          </div>
          <div className="library-view__card-progress">
            {anime.watchedEpisodes} / {totalDisplay}
          </div>
          <div
            className="library-view__progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={ratioPercent}
          >
            <div
              className="library-view__progress-bar-fill"
              style={{ width: `${ratioPercent}%` }}
            />
          </div>
          <span
            className={
              'library-view__status-badge library-view__status-badge--' +
              getWatchStatus(anime)
            }
          >
            {WATCH_STATUS_LABEL[getWatchStatus(anime)]}
          </span>
          <span
            className={
              'library-view__status-badge library-view__status-badge--' +
              anime.status
            }
          >
            {AIR_STATUS_LABEL[anime.status]}
          </span>
        </div>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 封面（带 onError 回退）
// ---------------------------------------------------------------------------

interface CoverProps {
  anime: TrackedAnime;
}

function RowCover(props: CoverProps): JSX.Element {
  const { anime } = props;
  const [failed, setFailed] = useState(false);
  const palette = useMemo(() => pickPaletteColor(anime.id), [anime.id]);
  const showFallback = failed || !anime.cover;

  // anime.cover 改变时重置失败态
  useEffect(() => {
    setFailed(false);
  }, [anime.cover]);

  if (showFallback) {
    return (
      <div
        className="library-view__cover library-view__cover--row library-view__cover--fallback"
        style={{ backgroundColor: palette.bg, color: palette.text }}
        aria-hidden="true"
      >
        {pickFallbackChar(anime)}
      </div>
    );
  }
  return (
    <img
      className="library-view__cover library-view__cover--row"
      src={anime.cover}
      alt=""
      referrerPolicy="no-referrer"
      draggable={false}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function CardCover(props: CoverProps): JSX.Element {
  const { anime } = props;
  const [failed, setFailed] = useState(false);
  const palette = useMemo(() => pickPaletteColor(anime.id), [anime.id]);
  const showFallback = failed || !anime.cover;

  useEffect(() => {
    setFailed(false);
  }, [anime.cover]);

  if (showFallback) {
    return (
      <div
        className="library-view__cover library-view__cover--card library-view__cover--fallback"
        style={{ backgroundColor: palette.bg, color: palette.text }}
        aria-hidden="true"
      >
        {pickFallbackChar(anime)}
      </div>
    );
  }
  return (
    <img
      className="library-view__cover library-view__cover--card"
      src={anime.cover}
      alt=""
      referrerPolicy="no-referrer"
      draggable={false}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
