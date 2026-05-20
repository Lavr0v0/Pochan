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
import { StatsView } from './views/StatsView';
import { checkAndNotifyTodayAiring } from './lib/notification';
import { shakeWindow } from './lib/windowEffects';
import type { TrackedAnime } from './types';

import './App.css';

type PanelTab = 'library' | 'calendar' | 'stats' | 'settings';
type MobileTab = 'bubble' | 'library' | 'calendar' | 'stats' | 'settings';

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
  const [completingId, setCompletingId] = useState<number | null>(null);
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

  // 数据加载完成后：刷新放送状态 + 检查今日更新通知
  useEffect(() => {
    if (!isLoaded || animes.length === 0) return;

    // 根据 airDate + totalEpisodes 重新计算每部番的放送状态
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    for (const anime of animes) {
      if (!anime.airDate) continue; // 没有开播日期的跳过，保持原状态

      let correctStatus: 'airing' | 'finished' | 'upcoming';

      if (anime.airDate > todayStr) {
        // 还没开播
        correctStatus = 'upcoming';
      } else if (anime.totalEpisodes > 0) {
        // 有总集数：估算结束日 = 开播日 + 总集数 × 7天
        const startDate = new Date(anime.airDate);
        const estimatedEnd = new Date(startDate.getTime() + anime.totalEpisodes * 7 * 24 * 60 * 60 * 1000);
        correctStatus = now < estimatedEnd ? 'airing' : 'finished';
      } else {
        // 总集数未知 + 已开播 + 有 airDay → 连载中
        correctStatus = anime.airDay !== undefined ? 'airing' : 'finished';
      }

      if (anime.status !== correctStatus) {
        updateAnime(anime.id, { status: correctStatus });
      }
    }

    void checkAndNotifyTodayAiring(animes);
  }, [isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // 只有已完结的番看完最后一集才自动标为"看完"
    // 连载中的番看完当前集数不算看完（还会更新）
    if (
      anime.status === 'finished' &&
      anime.totalEpisodes > 0 &&
      anime.watchedEpisodes + 1 >= anime.totalEpisodes
    ) {
      setCompletingId(animeId);
      void shakeWindow();
      setTimeout(() => {
        updateAnime(animeId, { watchStatus: 'completed' });
        setCompletingId(null);
      }, 1400);
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
      {/* 自定义标题栏 */}
      <div
        className="app__titlebar"
        onMouseDown={(e) => {
          if (e.buttons === 1 && e.detail === 2) {
            import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
              getCurrentWindow().toggleMaximize();
            });
          } else if (e.buttons === 1) {
            import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
              getCurrentWindow().startDragging();
            });
          }
        }}
      >
        <span className="app__titlebar-title">Pochan</span>
        <div className="app__titlebar-controls">
          <button
            className="app__titlebar-btn"
            aria-label="最小化"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
                getCurrentWindow().minimize();
              });
            }}
          >
            <svg width="10" height="1" viewBox="0 0 10 1"><rect fill="currentColor" width="10" height="1"/></svg>
          </button>
          <button
            className="app__titlebar-btn"
            aria-label="最大化"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
                getCurrentWindow().toggleMaximize();
              });
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9"/></svg>
          </button>
          <button
            className="app__titlebar-btn app__titlebar-btn--close"
            aria-label="关闭"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
                getCurrentWindow().close();
              });
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg>
          </button>
        </div>
      </div>
      {/* 主内容区 */}
      <div className="app__body">
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
          <button
            className={`app__panel-tab ${panelTab === 'stats' ? 'app__panel-tab--active' : ''}`}
            onClick={() => setPanelTab('stats')}
          >
            统计
          </button>
        </div>
        <div className="app__panel-content">
          {panelTab === 'library' && <LibraryView />}
          {panelTab === 'calendar' && <CalendarView />}
          {panelTab === 'settings' && <SettingsView />}
          {panelTab === 'stats' && <StatsView />}
        </div>
      </div>

      {/* 右侧气泡画布（移动端：仅 bubble tab 时显示） */}
      <div className={`app__canvas${isMobile && mobileTab !== 'bubble' ? ' app__canvas--hidden' : ''}`}>
        <BubbleCanvas
          animes={watchingAnimes}
          completingId={completingId}
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
          ＋ 添加番剧
        </button>
      </div>
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
        <button
          className={`app__bottom-nav-item${mobileTab === 'stats' ? ' app__bottom-nav-item--active' : ''}`}
          onClick={() => handleMobileTabChange('stats')}
        >
          <span className="app__bottom-nav-icon" aria-hidden="true">📊</span>
          <span className="app__bottom-nav-label">统计</span>
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
