/**
 * App 顶层组件 — 左右分屏布局
 *
 * 右侧：气泡画布（永远可见，app 的灵魂）
 * 左侧：功能面板（番剧库 / 日历 / 设置 切换）
 */

import { useCallback, useEffect, useState } from 'react';

import { useAnimeStore } from './store/useAnimeStore';
import { BubbleCanvas } from './components/BubbleCanvas';
import { AddAnimeDialog } from './components/AddAnimeDialog';
import { Toast } from './components/Toast';
import { LibraryView } from './views/LibraryView';
import { CalendarView } from './views/CalendarView';
import { SettingsView } from './views/SettingsView';
import type { TrackedAnime } from './types';

import './App.css';

type PanelTab = 'library' | 'calendar' | 'settings';
type MobileTab = 'bubble' | 'library' | 'calendar' | 'settings';

/** 检测是否为移动端视口 */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

/** 兼容旧数据 */
function isWatching(a: TrackedAnime): boolean {
  return (a.watchStatus ?? 'watching') === 'watching';
}

function App(): JSX.Element {
  const [panelTab, setPanelTab] = useState<PanelTab>('library');
  const [mobileTab, setMobileTab] = useState<MobileTab>('bubble');
  const [addOpen, setAddOpen] = useState(false);
  const isMobile = useIsMobile();
  const isLoaded = useAnimeStore((s) => s.isLoaded);
  const loadFromDisk = useAnimeStore((s) => s.loadFromDisk);
  const animes = useAnimeStore((s) => s.animes);
  const incrementWatched = useAnimeStore((s) => s.incrementWatched);
  const decrementWatched = useAnimeStore((s) => s.decrementWatched);
  const updateAnime = useAnimeStore((s) => s.updateAnime);

  useEffect(() => {
    void loadFromDisk();
  }, [loadFromDisk]);

  /** 移动端切换 tab 时同步 panelTab */
  const handleMobileTabChange = useCallback((tab: MobileTab) => {
    setMobileTab(tab);
    if (tab !== 'bubble') {
      setPanelTab(tab);
    }
  }, []);

  if (!isLoaded) {
    return <div className="app__loading">加载中…</div>;
  }

  // 气泡视图只显示「在看」的番
  const watchingAnimes = animes.filter(isWatching);

  // 气泡交互
  const handleBubbleClick = (animeId: number) => {
    const anime = animes.find((a) => a.id === animeId);
    if (!anime) return;
    if (anime.totalEpisodes > 0 && anime.watchedEpisodes >= anime.totalEpisodes) return;
    incrementWatched(animeId);

    // 看完最后一集 → 触发完成动画 + 设为看完
    if (anime.totalEpisodes > 0 && anime.watchedEpisodes + 1 >= anime.totalEpisodes) {
      // 给气泡加 completed class（动画 1.2s），然后改状态
      setTimeout(() => updateAnime(animeId, { watchStatus: 'completed' }), 1200);
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
      }).catch(() => {});
    }
  };

  const handleBubbleDoubleClick = (_animeId: number) => {
    // 空：避免连点误触
  };

  const handleBubbleContextMenu = (animeId: number, _x: number, _y: number) => {
    decrementWatched(animeId);
  };

  return (
    <div className="app">
      {/* 左侧面板（移动端：非 bubble tab 时显示） */}
      <div className={`app__panel${isMobile && mobileTab === 'bubble' ? ' app__panel--hidden' : ''}`}>
        <div className="app__panel-tabs">
          <button
            className={`app__panel-tab ${panelTab === 'library' ? 'app__panel-tab--active' : ''}`}
            onClick={() => setPanelTab('library')}
          >
            番剧库
          </button>
          <button
            className={`app__panel-tab ${panelTab === 'calendar' ? 'app__panel-tab--active' : ''}`}
            onClick={() => setPanelTab('calendar')}
          >
            日历
          </button>
          <button
            className={`app__panel-tab ${panelTab === 'settings' ? 'app__panel-tab--active' : ''}`}
            onClick={() => setPanelTab('settings')}
          >
            设置
          </button>
        </div>
        <div className="app__panel-content">
          {panelTab === 'library' && <LibraryView />}
          {panelTab === 'calendar' && <CalendarView />}
          {panelTab === 'settings' && <SettingsView />}
        </div>
      </div>

      {/* 右侧气泡画布（移动端：仅 bubble tab 时显示） */}
      <div className={`app__canvas${isMobile && mobileTab !== 'bubble' ? ' app__canvas--hidden' : ''}`}>
        <BubbleCanvas
          animes={watchingAnimes}
          onBubbleClick={handleBubbleClick}
          onBubbleDoubleClick={handleBubbleDoubleClick}
          onBubbleContextMenu={handleBubbleContextMenu}
        />
        {/* FAB 添加按钮 */}
        <button
          className="app__fab"
          onClick={() => setAddOpen(true)}
          aria-label="添加番剧"
        >
          +
        </button>
      </div>

      {/* 移动端底部导航 */}
      <nav className="app__bottom-nav" aria-label="底部导航">
        <button
          className={`app__bottom-nav-item${mobileTab === 'bubble' ? ' app__bottom-nav-item--active' : ''}`}
          onClick={() => handleMobileTabChange('bubble')}
        >
          <span className="app__bottom-nav-icon" aria-hidden="true">🫧</span>
          <span className="app__bottom-nav-label">气泡</span>
        </button>
        <button
          className={`app__bottom-nav-item${mobileTab === 'library' ? ' app__bottom-nav-item--active' : ''}`}
          onClick={() => handleMobileTabChange('library')}
        >
          <span className="app__bottom-nav-icon" aria-hidden="true">📚</span>
          <span className="app__bottom-nav-label">番剧库</span>
        </button>
        <button
          className={`app__bottom-nav-item${mobileTab === 'calendar' ? ' app__bottom-nav-item--active' : ''}`}
          onClick={() => handleMobileTabChange('calendar')}
        >
          <span className="app__bottom-nav-icon" aria-hidden="true">📅</span>
          <span className="app__bottom-nav-label">日历</span>
        </button>
        <button
          className={`app__bottom-nav-item${mobileTab === 'settings' ? ' app__bottom-nav-item--active' : ''}`}
          onClick={() => handleMobileTabChange('settings')}
        >
          <span className="app__bottom-nav-icon" aria-hidden="true">⚙️</span>
          <span className="app__bottom-nav-label">设置</span>
        </button>
      </nav>

      {/* 全局弹窗 */}
      {addOpen && (
        <AddAnimeDialog open={addOpen} onClose={() => setAddOpen(false)} />
      )}
      <Toast />
    </div>
  );
}

export default App;
