/**
 * BubbleView 路由容器
 *
 * 交互：
 *   - 左键单击 = 看了一集（不能超过总集数）
 *   - 看完最后一集 = 浮出屏幕 + 震窗口 + 自动设为「看完」（不再出现在气泡视图）
 *   - 右键单击 = 撤回一集
 *   - 左右键同时按下 = 弃番（沉出屏幕 + 设为「弃番」）
 *
 * 仅显示 watchStatus === 'watching' 的番剧。
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { useAnimeStore } from '../store/useAnimeStore';
import type { TrackedAnime } from '../types';
import { BubbleCanvas } from '../components/BubbleCanvas';
import { AddAnimeDialog } from '../components/AddAnimeDialog';

import './BubbleView.css';

export type ViewKey = 'bubble' | 'calendar' | 'library' | 'settings';

/** 把一个 anime 视为「在看」（兼容旧数据：未设 watchStatus 的视为 watching） */
function isWatching(a: TrackedAnime): boolean {
  return (a.watchStatus ?? 'watching') === 'watching';
}

export function BubbleView(): JSX.Element {
  const animes = useAnimeStore((s) => s.animes);
  const incrementWatched = useAnimeStore((s) => s.incrementWatched);
  const decrementWatched = useAnimeStore((s) => s.decrementWatched);
  const updateAnime = useAnimeStore((s) => s.updateAnime);

  const [searchText, setSearchText] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  // 仅显示「在看」状态的番剧
  const watchingAnimes = useMemo(
    () => animes.filter(isWatching),
    [animes],
  );

  const filteredAnimes = useMemo<TrackedAnime[]>(() => {
    const keyword = searchText.trim().toLowerCase();
    if (keyword.length === 0) return watchingAnimes;
    return watchingAnimes.filter((a) => {
      const name = (a.name || '').toLowerCase();
      const nameCn = (a.nameCn || '').toLowerCase();
      return name.includes(keyword) || nameCn.includes(keyword);
    });
  }, [watchingAnimes, searchText]);

  /**
   * 同时按下检测：当左键和右键的按下时间间隔 < 200ms，视为「同时双击」=弃番。
   * 用 buttonStateRef 跟踪每个气泡上各按键最近的按下时间。
   */
  const buttonStateRef = useRef<
    Map<number, { left: number; right: number }>
  >(new Map());

  /** 检测左右键是否在 200ms 内同时按下；如果是 → 弃番并返回 true */
  const checkBothButtonsAndDrop = useCallback(
    (animeId: number): boolean => {
      const state = buttonStateRef.current.get(animeId);
      if (!state) return false;
      const both = Math.abs(state.left - state.right) < 200 && state.left > 0 && state.right > 0;
      if (both) {
        buttonStateRef.current.delete(animeId);
        // 弃番：沉出屏幕动画 + 改状态
        updateAnime(animeId, { watchStatus: 'dropped' });
        return true;
      }
      return false;
    },
    [updateAnime],
  );

  const recordButtonPress = useCallback(
    (animeId: number, button: 'left' | 'right') => {
      const now = Date.now();
      const state = buttonStateRef.current.get(animeId) ?? { left: 0, right: 0 };
      state[button] = now;
      buttonStateRef.current.set(animeId, state);
    },
    [],
  );

  /** 左键：看了一集。看完最后一集时触发完成动画 */
  const handleBubbleClick = useCallback(
    (animeId: number) => {
      recordButtonPress(animeId, 'left');
      // 检查是否触发了「左右键同时」
      if (checkBothButtonsAndDrop(animeId)) return;

      const anime = animes.find((a) => a.id === animeId);
      if (!anime) return;

      // 已经看完了，不能再点
      if (anime.totalEpisodes > 0 && anime.watchedEpisodes >= anime.totalEpisodes) return;

      incrementWatched(animeId);

      // 刚好看完最后一集 → 完成动画 + 设为「看完」
      if (anime.totalEpisodes > 0 && anime.watchedEpisodes + 1 >= anime.totalEpisodes) {
        // 延迟改状态（让浮出动画播完）
        setTimeout(() => updateAnime(animeId, { watchStatus: 'completed' }), 1500);
        // 震窗口
        import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
          import('@tauri-apps/api/dpi').then(({ PhysicalPosition }) => {
            const win = getCurrentWindow();
            const shake = async () => {
              const pos = await win.outerPosition();
              for (let i = 0; i < 6; i++) {
                const offset = i % 2 === 0 ? 5 : -5;
                await win.setPosition(new PhysicalPosition(pos.x + offset, pos.y));
                await new Promise((r) => setTimeout(r, 40));
              }
              await win.setPosition(new PhysicalPosition(pos.x, pos.y));
            };
            void shake();
          });
        }).catch(() => { /* 非 Tauri 环境 */ });
      }
    },
    [animes, incrementWatched, recordButtonPress, checkBothButtonsAndDrop, updateAnime],
  );

  /** 双击左键：保留为空（避免连点误触发） */
  const handleBubbleDoubleClick = useCallback((_animeId: number) => {
    // 故意空
  }, []);

  /** 右键：撤回一集。同时检测左右键同时按下 → 弃番 */
  const handleBubbleContextMenu = useCallback(
    (animeId: number, _x: number, _y: number) => {
      recordButtonPress(animeId, 'right');
      if (checkBothButtonsAndDrop(animeId)) return;
      decrementWatched(animeId);
    },
    [decrementWatched, recordButtonPress, checkBothButtonsAndDrop],
  );

  return (
    <div className="bubble-view">
      <div className="bubble-view__toolbar">
        <input
          type="text"
          className="bubble-view__search"
          placeholder="搜索本地番剧"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          aria-label="搜索本地番剧"
        />
        <button
          type="button"
          className="bubble-view__add"
          onClick={() => setAddOpen(true)}
        >
          + 添加番剧
        </button>
      </div>

      <div className="bubble-view__canvas">
        <BubbleCanvas
          animes={filteredAnimes}
          onBubbleClick={handleBubbleClick}
          onBubbleDoubleClick={handleBubbleDoubleClick}
          onBubbleContextMenu={handleBubbleContextMenu}
        />
      </div>

      {addOpen && (
        <AddAnimeDialog open={addOpen} onClose={() => setAddOpen(false)} />
      )}
    </div>
  );
}

export default BubbleView;
