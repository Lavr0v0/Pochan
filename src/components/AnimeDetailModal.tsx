/**
 * AnimeDetailModal 番剧详情弹窗
 *
 * 实现 design.md "Components and Interfaces / AnimeDetailModal" 与
 * requirements.md Requirement 8（番剧详情弹窗）。
 *
 * 职责：
 *   1. 展示完整元数据：封面、中日名、watchedEpisodes / totalEpisodes、
 *      上次观看时间、添加时间、类型徽章。
 *   2. 编辑：
 *        - 已看集数（数字输入 + 加减按钮）→ useAnimeStore.updateAnime，
 *          若数值上调则同步把 lastWatchedAt 改为当前时间。
 *        - 笔记（多行输入）→ useAnimeStore.updateAnime，500ms debounce 写入。
 *        - 自定义颜色（PALETTE 七色 + free-form color picker + 重置默认）
 *          → useAnimeStore.updateAnime。
 *   3. 删除：内联确认对话框 → useAnimeStore.removeAnime → onClose。
 *   4. 关闭：ESC 键、点击 overlay 都可关闭；删除确认显示后，仅菜单内的「取消 / 确认」
 *      可改变状态，overlay / ESC 不再生效（避免误操作）。
 *
 * 设计要点：
 *   - props 形态：当 anime === null 时整体 render null（drop open prop）。
 *   - 笔记输入采用本地受控 state + 500ms debounce 提交，避免每次按键都触发持久化。
 *     卸载或切换番时立即 flush，保证不丢失编辑。
 *   - 顶层 AnimeDetailModal 始终调用全部 hooks（即使 anime===null）以遵守
 *     Rules of Hooks；真正复杂的渲染交给内部 ModalContent 组件，仅在 anime
 *     非空时挂载。
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent } from 'react';

import type { TrackedAnime } from '../types';
import { PALETTE, pickPaletteColor } from '../types';
import { useAnimeStore } from '../store/useAnimeStore';

import './AnimeDetailModal.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AnimeDetailModalProps {
  /** 当前要展示的番剧；为 null 时本组件 render null */
  anime: TrackedAnime | null;
  /** 用户请求关闭弹窗（点击 overlay / ESC / 关闭按钮） */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 取番名首字作为封面回退占位（与 Bubble 组件保持一致） */
function pickFallbackChar(anime: TrackedAnime): string {
  const source = (anime.nameCn || anime.name || '').trim();
  if (source.length === 0) return '?';
  return Array.from(source)[0] ?? '?';
}

/** 用 zh-CN locale 格式化 ISO 时间戳；解析失败时回退到原始字符串 */
function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  return new Date(ts).toLocaleString('zh-CN');
}

/** 在传入数字非有限或非整数时返回 fallback；否则向下取整并夹到 [0, ∞) */
function sanitizeWatched(input: number, fallback: number): number {
  if (!Number.isFinite(input)) return fallback;
  return Math.max(0, Math.floor(input));
}

/** 笔记 debounce 提交延迟（ms） */
const NOTES_COMMIT_MS = 500;

// ---------------------------------------------------------------------------
// 顶层组件：anime 为 null 时 render null，其余交给 ModalContent
//
// 把全部 hooks 集中到 ModalContent 中调用，并通过 key={anime.id} 让 anime
// 切换时 ModalContent 完全重建（笔记草稿 / 删除确认状态自然回到初始值），
// 避免在父组件做条件 hooks 调用导致 Rules of Hooks 违规。
// ---------------------------------------------------------------------------

export function AnimeDetailModal(props: AnimeDetailModalProps): JSX.Element | null {
  const { anime, onClose } = props;
  if (anime === null) return null;
  return <ModalContent key={anime.id} anime={anime} onClose={onClose} />;
}

export default AnimeDetailModal;

// ---------------------------------------------------------------------------
// ModalContent：所有交互逻辑（仅在 anime 非空时挂载）
// ---------------------------------------------------------------------------

interface ModalContentProps {
  anime: TrackedAnime;
  onClose: () => void;
}

function ModalContent(props: ModalContentProps): JSX.Element {
  const { anime, onClose } = props;

  // —— store 动作 ——
  const updateAnime = useAnimeStore((s) => s.updateAnime);
  const removeAnime = useAnimeStore((s) => s.removeAnime);

  // —— 本地受控状态 ——
  // 笔记输入框；初始化使用 anime.notes（key={anime.id} 切换时自然重置）
  const [notesDraft, setNotesDraft] = useState<string>(anime.notes ?? '');
  // 删除确认对话框是否展开
  const [confirmingDelete, setConfirmingDelete] = useState<boolean>(false);

  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedNotesRef = useRef<string>(anime.notes ?? '');

  // 把笔记草稿 commit 到 store，仅当与最近 commit 不同才调用 updateAnime。
  const commitNotesIfChanged = useCallback(
    (id: number, value: string) => {
      if (lastCommittedNotesRef.current === value) return;
      lastCommittedNotesRef.current = value;
      updateAnime(id, { notes: value });
    },
    [updateAnime],
  );

  // 卸载时清理 pending debounce timer（key 切换或 modal 关闭都会触发）
  useEffect(() => {
    return () => {
      if (notesTimerRef.current !== null) {
        clearTimeout(notesTimerRef.current);
        notesTimerRef.current = null;
      }
    };
  }, []);

  // -------------------------------------------------------------------------
  // ESC 关闭（仅在非删除确认状态下生效）
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (confirmingDelete) return; // 删除确认时仅菜单按钮可改变状态
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [confirmingDelete, onClose]);

  // -------------------------------------------------------------------------
  // 进度编辑：数值输入 + +1 / -1 按钮
  // -------------------------------------------------------------------------

  const setWatched = useCallback(
    (next: number) => {
      const clamped = sanitizeWatched(next, anime.watchedEpisodes);
      if (clamped === anime.watchedEpisodes) return;
      const patch: Partial<TrackedAnime> = { watchedEpisodes: clamped };
      // 仅在数值上调时同步 lastWatchedAt（与 incrementWatched 行为一致）
      if (clamped > anime.watchedEpisodes) {
        patch.lastWatchedAt = new Date().toISOString();
      }
      updateAnime(anime.id, patch);
    },
    [anime.id, anime.watchedEpisodes, updateAnime],
  );

  const handleWatchedInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      // 空字符串：暂不提交（用户正在清空重新输入）
      if (raw === '') return;
      const parsed = Number(raw);
      setWatched(parsed);
    },
    [setWatched],
  );

  const handleWatchedInc = useCallback(() => {
    setWatched(anime.watchedEpisodes + 1);
  }, [anime.watchedEpisodes, setWatched]);

  const handleWatchedDec = useCallback(() => {
    setWatched(anime.watchedEpisodes - 1);
  }, [anime.watchedEpisodes, setWatched]);

  // -------------------------------------------------------------------------
  // 笔记编辑：受控输入 + 500ms debounce 写入 store
  // -------------------------------------------------------------------------

  const handleNotesChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setNotesDraft(value);
      if (notesTimerRef.current !== null) {
        clearTimeout(notesTimerRef.current);
      }
      const id = anime.id;
      notesTimerRef.current = setTimeout(() => {
        notesTimerRef.current = null;
        commitNotesIfChanged(id, value);
      }, NOTES_COMMIT_MS);
    },
    [anime.id, commitNotesIfChanged],
  );

  /** onBlur 立即 flush，避免用户切走后丢失最后一次编辑 */
  const handleNotesBlur = useCallback(() => {
    if (notesTimerRef.current !== null) {
      clearTimeout(notesTimerRef.current);
      notesTimerRef.current = null;
    }
    commitNotesIfChanged(anime.id, notesDraft);
  }, [anime.id, notesDraft, commitNotesIfChanged]);

  // -------------------------------------------------------------------------
  // 颜色编辑
  // -------------------------------------------------------------------------

  const handlePaletteSelect = useCallback(
    (hex: string) => {
      if (anime.color === hex) return;
      updateAnime(anime.id, { color: hex });
    },
    [anime.id, anime.color, updateAnime],
  );

  const handleColorPickerChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const hex = e.target.value;
      if (anime.color === hex) return;
      updateAnime(anime.id, { color: hex });
    },
    [anime.id, anime.color, updateAnime],
  );

  const handleColorReset = useCallback(() => {
    if (anime.color === undefined) return;
    // updateAnime 走对象 spread 合并，传 undefined 会显式把 color 设为 undefined
    updateAnime(anime.id, { color: undefined });
  }, [anime.id, anime.color, updateAnime]);

  // -------------------------------------------------------------------------
  // 删除流程：点击 → 进入确认 → 取消 / 确认
  // -------------------------------------------------------------------------

  const handleDeleteRequest = useCallback(() => {
    setConfirmingDelete(true);
  }, []);

  const handleDeleteCancel = useCallback(() => {
    setConfirmingDelete(false);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    const id = anime.id;
    if (notesTimerRef.current !== null) {
      clearTimeout(notesTimerRef.current);
      notesTimerRef.current = null;
    }
    removeAnime(id);
    setConfirmingDelete(false);
    onClose();
  }, [anime.id, onClose, removeAnime]);

  // -------------------------------------------------------------------------
  // overlay 点击关闭：仅在非删除确认状态下生效
  // -------------------------------------------------------------------------

  const handleOverlayClick = useCallback(() => {
    if (confirmingDelete) return;
    onClose();
  }, [confirmingDelete, onClose]);

  /** 阻止事件穿透到 overlay */
  const stopPropagation = useCallback((e: MouseEvent) => {
    e.stopPropagation();
  }, []);

  /** 数值输入按 Enter 时取消默认行为并 blur，触发 onBlur 写盘 */
  const handleNumberKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        (e.currentTarget as HTMLInputElement).blur();
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // 派生展示数据
  // -------------------------------------------------------------------------

  const displayPrimary = anime.nameCn || anime.name || '(未命名)';
  const displaySecondary = anime.nameCn ? anime.name : '';
  const totalDisplay = anime.totalEpisodes > 0 ? anime.totalEpisodes : '?';
  const defaultPalette = pickPaletteColor(anime.id);
  const currentColor = anime.color ?? defaultPalette.bg;
  const isCustomColor = anime.color !== undefined;

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  return (
    <div
      className="anime-detail-modal__overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${displayPrimary} 详情`}
      onClick={handleOverlayClick}
    >
      <div
        className="anime-detail-modal__card"
        onClick={stopPropagation}
        // 阻止 mousedown 在 overlay 捕获阶段冒泡（与 BubbleView 的 context-menu 监听并存）
        onMouseDown={stopPropagation}
      >
        <div className="anime-detail-modal__body">
          {/* 左列：封面 */}
          <div className="anime-detail-modal__cover-col">
            <CoverWithFallback anime={anime} />
            <span
              className={`anime-detail-modal__status-badge anime-detail-modal__status-badge--${anime.status}`}
            >
              {anime.status === 'airing' ? '新番' : '老番'}
            </span>
          </div>

          {/* 右列：信息 + 表单 */}
          <div className="anime-detail-modal__info-col">
            <header className="anime-detail-modal__heading">
              <h2 className="anime-detail-modal__title">{displayPrimary}</h2>
              {displaySecondary && (
                <p className="anime-detail-modal__subtitle">{displaySecondary}</p>
              )}
            </header>

            <dl className="anime-detail-modal__meta">
              <div className="anime-detail-modal__meta-row">
                <dt>总集数</dt>
                <dd>{totalDisplay}</dd>
              </div>
              <div className="anime-detail-modal__meta-row">
                <dt>上次观看</dt>
                <dd>{formatDateTime(anime.lastWatchedAt)}</dd>
              </div>
              <div className="anime-detail-modal__meta-row">
                <dt>添加时间</dt>
                <dd>{formatDateTime(anime.addedAt)}</dd>
              </div>
            </dl>

            {/* 简介（来自 Bangumi） */}
            {anime.summary && (
              <section className="anime-detail-modal__field">
                <span className="anime-detail-modal__field-label">简介</span>
                <p className="anime-detail-modal__summary">{anime.summary}</p>
              </section>
            )}

            {/* 已看集数编辑 */}
            <section className="anime-detail-modal__field">
              <label
                className="anime-detail-modal__field-label"
                htmlFor="anime-detail-modal-watched"
              >
                已看集数
              </label>
              <div className="anime-detail-modal__watched-row">
                <button
                  type="button"
                  className="anime-detail-modal__icon-button"
                  aria-label="减一集"
                  onClick={handleWatchedDec}
                  disabled={anime.watchedEpisodes <= 0}
                >
                  −
                </button>
                <input
                  id="anime-detail-modal-watched"
                  type="number"
                  min={0}
                  step={1}
                  value={anime.watchedEpisodes}
                  onChange={handleWatchedInputChange}
                  onKeyDown={handleNumberKeyDown}
                  className="anime-detail-modal__watched-input"
                />
                <span className="anime-detail-modal__watched-total">
                  / {totalDisplay}
                </span>
                <button
                  type="button"
                  className="anime-detail-modal__icon-button"
                  aria-label="加一集"
                  onClick={handleWatchedInc}
                >
                  +
                </button>
              </div>
            </section>

            {/* 笔记编辑 */}
            <section className="anime-detail-modal__field">
              <label
                className="anime-detail-modal__field-label"
                htmlFor="anime-detail-modal-notes"
              >
                笔记
              </label>
              <textarea
                id="anime-detail-modal-notes"
                className="anime-detail-modal__notes"
                value={notesDraft}
                onChange={handleNotesChange}
                onBlur={handleNotesBlur}
                placeholder="写一点关于这部番的想法…"
                rows={3}
              />
            </section>

            {/* 自定义颜色 */}
            <section className="anime-detail-modal__field">
              <span className="anime-detail-modal__field-label">自定义颜色</span>
              <div
                className="anime-detail-modal__palette"
                role="radiogroup"
                aria-label="选择气泡颜色"
              >
                {PALETTE.map((color) => {
                  const selected = anime.color === color.bg;
                  return (
                    <button
                      key={color.bg}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={color.bg}
                      className={
                        'anime-detail-modal__swatch' +
                        (selected ? ' anime-detail-modal__swatch--selected' : '')
                      }
                      style={{ backgroundColor: color.bg }}
                      onClick={() => handlePaletteSelect(color.bg)}
                    />
                  );
                })}
              </div>
              <div className="anime-detail-modal__color-extra">
                <label className="anime-detail-modal__picker-label">
                  <span>自选</span>
                  <input
                    type="color"
                    value={currentColor}
                    onChange={handleColorPickerChange}
                    aria-label="自定义颜色（hex）"
                  />
                </label>
                <button
                  type="button"
                  className="anime-detail-modal__reset-color"
                  onClick={handleColorReset}
                  disabled={!isCustomColor}
                >
                  重置为默认
                </button>
              </div>
            </section>
          </div>
        </div>

        {/* 底部按钮区 */}
        <footer className="anime-detail-modal__footer">
          {!confirmingDelete ? (
            <>
              <button
                type="button"
                className="anime-detail-modal__delete-button"
                onClick={handleDeleteRequest}
              >
                删除
              </button>
              <button
                type="button"
                className="anime-detail-modal__close-button"
                onClick={onClose}
              >
                关闭
              </button>
            </>
          ) : (
            <DeleteConfirmRow
              displayName={displayPrimary}
              onCancel={handleDeleteCancel}
              onConfirm={handleDeleteConfirm}
            />
          )}
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 内联子组件：封面（带 onError 回退）
// ---------------------------------------------------------------------------

interface CoverWithFallbackProps {
  anime: TrackedAnime;
}

function CoverWithFallback(props: CoverWithFallbackProps): JSX.Element {
  const { anime } = props;
  const [imgFailed, setImgFailed] = useState(false);

  // anime.cover 变化时重置失败状态（虽 ModalContent 通过 key 重建可减少这种情况，
  // 但保留以防 anime patch 中改了 cover）
  useEffect(() => {
    setImgFailed(false);
  }, [anime.cover]);

  const palette = useMemo(() => pickPaletteColor(anime.id), [anime.id]);
  const showFallback = imgFailed || !anime.cover;

  if (showFallback) {
    return (
      <div
        className="anime-detail-modal__cover anime-detail-modal__cover--fallback"
        style={{ backgroundColor: palette.bg, color: palette.text }}
        aria-hidden="true"
      >
        <span className="anime-detail-modal__cover-fallback-char">
          {pickFallbackChar(anime)}
        </span>
      </div>
    );
  }

  return (
    <img
      className="anime-detail-modal__cover"
      src={anime.cover}
      alt=""
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setImgFailed(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// 内联子组件：删除确认行
// ---------------------------------------------------------------------------

interface DeleteConfirmRowProps {
  displayName: string;
  onCancel: () => void;
  onConfirm: () => void;
}

function DeleteConfirmRow(props: DeleteConfirmRowProps): JSX.Element {
  return (
    <div className="anime-detail-modal__confirm">
      <span className="anime-detail-modal__confirm-text">
        确定要删除「{props.displayName}」吗？
      </span>
      <div className="anime-detail-modal__confirm-actions">
        <button
          type="button"
          className="anime-detail-modal__close-button"
          onClick={props.onCancel}
          autoFocus
        >
          取消
        </button>
        <button
          type="button"
          className="anime-detail-modal__delete-button anime-detail-modal__delete-button--confirm"
          onClick={props.onConfirm}
        >
          确认删除
        </button>
      </div>
    </div>
  );
}
