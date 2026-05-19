/**
 * SettingsView 设置页
 *
 * 实现 design.md "Components and Interfaces / Settings"（取自 Sidebar 与
 * Anime_Store 的导入/导出 API）与 requirements.md Requirement 10
 * （清空 / 导出 / 导入）。
 *
 * 三个功能区：
 *   1. 数据导出：调 Tauri save 对话框选位置 → adapter.exportJson 内容写入
 *      选定文件 → 显示「已导出到 {path}」。用户取消则什么都不做。
 *   2. 数据导入：调 Tauri open 对话框 → readTextFile → store.importJson 校验
 *      → 成功显示「已导入 N 部番剧（替换原有数据）」；失败显示「文件格式不正确：…」。
 *   3. 清空全部数据：内联确认行（与 AnimeDetailModal 删除确认风格一致）→
 *      用户点确认 → store.clearAll → 显示「已清空」。
 *
 * 设计要点：
 *   - 直接 import 顶层 `useAnimeStore`（与 BubbleView / LibraryView 保持一致）。
 *     单元测试若需要替换 store，可用模块 mock 或沿用集成测试方式。
 *   - 三个功能区各自维护独立的 status state（type + message），互不干扰；
 *     某一项的新操作开始时会清掉自己的旧 status，避免误读历史结果。
 *   - 使用「内联确认行」而非 Tauri confirm（按任务说明），以及与 AnimeDetailModal
 *     一致的视觉模式：左侧文案 + 右侧 取消 / 确认 按钮。
 *   - 导出默认文件名：`bangumi-bubble-{ISO 日期 YYYY-MM-DD}.json`。
 *   - 导入时若用户取消文件对话框（返回 null），保持当前数据并清空 status。
 *   - 错误显示：捕获 `unknown`，统一用 toErrorMessage 转字符串，避免 `[object Object]`。
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

import { useCallback, useEffect, useState } from 'react';

import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

import { useAnimeStore } from '../store/useAnimeStore';
import { importFromBangumi, BangumiError } from '../lib/bangumi';
import { applyTheme, getStoredTheme, setStoredTheme, getUnlockedThemes, checkAndUnlockThemes, unlockPinkTheme, THEME_UNLOCK_CONDITIONS, SPECIAL_THEMES } from '../lib/theme';
import type { ThemeMode } from '../lib/theme';

import './SettingsView.css';

// ---------------------------------------------------------------------------
// 类型 & 工具
// ---------------------------------------------------------------------------

type StatusKind = 'success' | 'error' | 'info';

interface StatusMessage {
  kind: StatusKind;
  text: string;
}

/** 统一把 unknown 错误转成可读字符串 */
function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** 生成默认导出文件名：bangumi-bubble-YYYY-MM-DD.json */
function defaultExportFileName(now: Date = new Date()): string {
  const iso = now.toISOString();
  const datePart = iso.slice(0, 10); // YYYY-MM-DD
  return `bangumi-bubble-${datePart}.json`;
}

const JSON_FILTER = {
  name: 'JSON',
  extensions: ['json'],
} as const;

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export function SettingsView(): JSX.Element {
  // —— store ——
  const animes = useAnimeStore((s) => s.animes);
  const clearAll = useAnimeStore((s) => s.clearAll);
  const exportJson = useAnimeStore((s) => s.exportJson);
  const importJson = useAnimeStore((s) => s.importJson);

  // —— 三个功能区各自独立的 status state ——
  const [exportStatus, setExportStatus] = useState<StatusMessage | null>(null);
  const [importStatus, setImportStatus] = useState<StatusMessage | null>(null);
  const [clearStatus, setClearStatus] = useState<StatusMessage | null>(null);

  // —— 进行中标志：防止用户重复点击导致多个对话框竞态 ——
  const [exporting, setExporting] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);

  // —— 清空确认行 ——
  const [confirmingClear, setConfirmingClear] = useState<boolean>(false);

  // —— Bangumi 导入 ——
  const [bangumiUsername, setBangumiUsername] = useState<string>('');
  const [bangumiImporting, setBangumiImporting] = useState<boolean>(false);
  const [bangumiStatus, setBangumiStatus] = useState<StatusMessage | null>(null);

  // —— 主题切换 ——
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const [unlockedThemes, setUnlockedThemes] = useState<ThemeMode[]>(() => getUnlockedThemes());

  // 检查解锁条件
  const completedCount = animes.filter((a) => (a.watchStatus ?? 'watching') === 'completed').length;
  const totalWatchedEpisodes = animes.reduce((sum, a) => sum + a.watchedEpisodes, 0);

  useEffect(() => {
    const newlyUnlocked = checkAndUnlockThemes(completedCount, totalWatchedEpisodes);
    if (newlyUnlocked.length > 0) {
      setUnlockedThemes(getUnlockedThemes());
    }
  }, [completedCount, totalWatchedEpisodes]);

  const handleThemeChange = useCallback((mode: ThemeMode) => {
    setTheme(mode);
    setStoredTheme(mode);
    applyTheme(mode);
  }, []);

  const addAnime = useAnimeStore((s) => s.addAnime);
  const animeCount = animes.length;

  // -------------------------------------------------------------------------
  // 导出 JSON
  //
  // 流程：
  //   1. 打开 Tauri save 对话框，默认文件名 bangumi-bubble-YYYY-MM-DD.json
  //   2. 用户取消 → 清掉旧 status 直接返回
  //   3. 用户选定路径 → 调 store.exportJson() 拿到字符串 → writeTextFile
  //   4. 写入成功 → 显示「已导出到 {path}」
  //   5. 任意环节抛错 → 显示「导出失败：{msg}」
  // -------------------------------------------------------------------------
  // 从 Bangumi 导入
  // -------------------------------------------------------------------------

  const handleBangumiImport = useCallback(async () => {
    const username = bangumiUsername.trim();
    if (username.length === 0 || bangumiImporting) return;
    setBangumiImporting(true);
    setBangumiStatus(null);
    try {
      const imported = await importFromBangumi(username);
      if (imported.length === 0) {
        setBangumiStatus({ kind: 'info', text: '该用户没有公开的动画收藏' });
        return;
      }
      // 追加导入：跳过已存在的（按 id 去重）
      const existingIds = new Set(animes.map((a) => a.id));
      let added = 0;
      for (const anime of imported) {
        if (!existingIds.has(anime.id)) {
          addAnime(anime);
          added++;
        }
      }
      setBangumiStatus({
        kind: 'success',
        text: `成功导入 ${added} 部番剧（跳过 ${imported.length - added} 部已存在的）`,
      });
      // 解锁粉色主题
      if (unlockPinkTheme()) {
        setUnlockedThemes(getUnlockedThemes());
      }
    } catch (err) {
      if (err instanceof BangumiError && err.status === 404) {
        setBangumiStatus({ kind: 'error', text: '用户不存在，请检查用户名' });
      } else {
        setBangumiStatus({ kind: 'error', text: `导入失败：${toErrorMessage(err)}` });
      }
    } finally {
      setBangumiImporting(false);
    }
  }, [bangumiUsername, bangumiImporting, animes, addAnime]);

  // -------------------------------------------------------------------------
  // 导出 JSON

  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    setExportStatus(null);
    try {
      const path = await save({
        defaultPath: defaultExportFileName(),
        filters: [{ name: JSON_FILTER.name, extensions: [...JSON_FILTER.extensions] }],
      });
      if (path === null || path === undefined) {
        // 用户取消
        return;
      }
      const content = exportJson();
      await writeTextFile(path, content);
      setExportStatus({ kind: 'success', text: `已导出到 ${path}` });
    } catch (err) {
      setExportStatus({ kind: 'error', text: `导出失败：${toErrorMessage(err)}` });
    } finally {
      setExporting(false);
    }
  }, [exportJson, exporting]);

  // -------------------------------------------------------------------------
  // 导入 JSON
  //
  // 流程：
  //   1. 打开 Tauri open 对话框
  //   2. 用户取消（返回 null/undefined）→ 清掉旧 status 返回
  //   3. 选定路径 → readTextFile → store.importJson(content) 校验
  //   4. importJson 内部抛错（schema 校验失败）→ 显示「文件格式不正确：…」
  //   5. 成功 → 用 useAnimeStore.getState().animes.length 读取替换后的数量
  // -------------------------------------------------------------------------

  const handleImport = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    setImportStatus(null);
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: JSON_FILTER.name, extensions: [...JSON_FILTER.extensions] }],
      });
      // open 返回 string | string[] | null（multiple: false 时为 string | null）
      if (selected === null || selected === undefined) {
        return;
      }
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (typeof path !== 'string' || path.length === 0) {
        return;
      }

      let content: string;
      try {
        content = await readTextFile(path);
      } catch (err) {
        setImportStatus({
          kind: 'error',
          text: `读取文件失败：${toErrorMessage(err)}`,
        });
        return;
      }

      try {
        importJson(content);
      } catch (err) {
        // adapter.importJson 抛出的错误形如 "import: invalid schema: ..."
        const raw = toErrorMessage(err);
        const cleaned = raw
          .replace(/^import:\s*invalid schema:\s*/, '')
          .trim() || raw;
        setImportStatus({ kind: 'error', text: `文件格式不正确：${cleaned}` });
        return;
      }

      // 成功：从 store 读取替换后的实际数量（importJson 已同步替换）
      const count = useAnimeStore.getState().animes.length;
      setImportStatus({
        kind: 'success',
        text: `已导入 ${count} 部番剧（替换原有数据）`,
      });
    } catch (err) {
      setImportStatus({ kind: 'error', text: `导入失败：${toErrorMessage(err)}` });
    } finally {
      setImporting(false);
    }
  }, [importJson, importing]);

  // -------------------------------------------------------------------------
  // 清空全部数据
  //
  // 流程（内联确认）：
  //   1. 点击「清空全部数据」→ 显示确认行
  //   2. 用户点「取消」→ 关闭确认行
  //   3. 用户点「确认清空」→ store.clearAll() → 显示「已清空」
  // -------------------------------------------------------------------------

  const handleRequestClear = useCallback(() => {
    setClearStatus(null);
    setConfirmingClear(true);
  }, []);

  const handleCancelClear = useCallback(() => {
    setConfirmingClear(false);
  }, []);

  const handleConfirmClear = useCallback(() => {
    clearAll();
    setConfirmingClear(false);
    setClearStatus({ kind: 'success', text: '已清空' });
  }, [clearAll]);

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  return (
    <div className="settings-view">
      <header className="settings-view__header">
        <h1 className="settings-view__title">设置</h1>
        <p className="settings-view__subtitle">本地数据的备份与维护</p>
      </header>

      <div className="settings-view__body">
        <div className="settings-view__inner">
          {/* —— 外观主题 —— */}
          <section className="settings-view__card" aria-label="外观主题">
            <h2 className="settings-view__card-heading">外观</h2>
            <p className="settings-view__card-desc">
              选择应用的颜色模式。特殊主题通过追番成就解锁。
            </p>
            <div className="settings-view__theme-options" role="radiogroup" aria-label="主题选择">
              <button
                type="button"
                role="radio"
                aria-checked={theme === 'light'}
                className={`settings-view__theme-button${theme === 'light' ? ' settings-view__theme-button--active' : ''}`}
                onClick={() => handleThemeChange('light')}
              >
                浅色
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={theme === 'dark'}
                className={`settings-view__theme-button${theme === 'dark' ? ' settings-view__theme-button--active' : ''}`}
                onClick={() => handleThemeChange('dark')}
              >
                深色
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={theme === 'auto'}
                className={`settings-view__theme-button${theme === 'auto' ? ' settings-view__theme-button--active' : ''}`}
                onClick={() => handleThemeChange('auto')}
              >
                跟随系统
              </button>
              {SPECIAL_THEMES.map((t) => {
                const isUnlocked = unlockedThemes.includes(t);
                const labels: Record<string, string> = { pink: '樱花', blue: '海蓝', gold: '金色' };
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={theme === t}
                    className={
                      `settings-view__theme-button` +
                      (theme === t ? ' settings-view__theme-button--active' : '') +
                      (!isUnlocked ? ' settings-view__theme-button--locked' : '')
                    }
                    onClick={() => isUnlocked && handleThemeChange(t)}
                    disabled={!isUnlocked}
                    title={isUnlocked ? labels[t] : `🔒 ${THEME_UNLOCK_CONDITIONS[t]}`}
                  >
                    {isUnlocked ? labels[t] : '???'}
                  </button>
                );
              })}
            </div>
          </section>

          {/* —— 数据导出 —— */}
          <section className="settings-view__card" aria-label="数据导出">
            <h2 className="settings-view__card-heading">数据导出</h2>
            <p className="settings-view__card-desc">
              将当前 {animeCount} 部追番记录导出为 JSON 文件，作为备份或迁移到其他设备使用。
            </p>
            <div className="settings-view__actions">
              <button
                type="button"
                className="settings-view__button settings-view__button--primary"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? '正在导出…' : '导出 JSON'}
              </button>
            </div>
            {exportStatus && (
              <p
                className={`settings-view__status settings-view__status--${exportStatus.kind}`}
                role={exportStatus.kind === 'error' ? 'alert' : 'status'}
              >
                {exportStatus.text}
              </p>
            )}
          </section>

          {/* —— 从 Bangumi 导入 —— */}
          <section className="settings-view__card" aria-label="从 Bangumi 导入">
            <h2 className="settings-view__card-heading">从 Bangumi 导入</h2>
            <p className="settings-view__card-desc">
              输入 Bangumi 用户名，一键导入你的追番列表（公开收藏，无需登录）。
              导入的番剧会<strong>追加</strong>到现有数据中（不会覆盖已有的番）。
            </p>
            <div className="settings-view__actions">
              <input
                type="text"
                className="settings-view__input"
                placeholder="Bangumi 用户名或 UID"
                value={bangumiUsername}
                onChange={(e) => setBangumiUsername(e.target.value)}
                disabled={bangumiImporting}
              />
              <button
                type="button"
                className="settings-view__button settings-view__button--primary"
                onClick={handleBangumiImport}
                disabled={bangumiImporting || bangumiUsername.trim().length === 0}
              >
                {bangumiImporting ? '导入中…' : '导入'}
              </button>
            </div>
            {bangumiStatus && (
              <p
                className={`settings-view__status settings-view__status--${bangumiStatus.kind}`}
                role={bangumiStatus.kind === 'error' ? 'alert' : 'status'}
              >
                {bangumiStatus.text}
              </p>
            )}
          </section>

          {/* —— 数据导入 —— */}
          <section className="settings-view__card" aria-label="数据导入">
            <h2 className="settings-view__card-heading">数据导入</h2>
            <p className="settings-view__card-desc">
              从 JSON 文件恢复追番数据。导入会<strong>替换</strong>当前所有数据，请先确认已做好备份。
            </p>
            <div className="settings-view__actions">
              <button
                type="button"
                className="settings-view__button"
                onClick={handleImport}
                disabled={importing}
              >
                {importing ? '正在导入…' : '导入 JSON'}
              </button>
            </div>
            {importStatus && (
              <p
                className={`settings-view__status settings-view__status--${importStatus.kind}`}
                role={importStatus.kind === 'error' ? 'alert' : 'status'}
              >
                {importStatus.text}
              </p>
            )}
          </section>

          {/* —— 清空全部数据 —— */}
          <section className="settings-view__card" aria-label="清空全部数据">
            <h2 className="settings-view__card-heading">清空全部数据</h2>
            <p className="settings-view__card-desc">
              删除所有追番记录。此操作无法撤销，建议先导出 JSON 备份。
            </p>
            {!confirmingClear ? (
              <div className="settings-view__actions">
                <button
                  type="button"
                  className="settings-view__button settings-view__button--danger"
                  onClick={handleRequestClear}
                  disabled={animeCount === 0}
                >
                  清空全部数据
                </button>
                {animeCount === 0 && (
                  <span className="settings-view__status settings-view__status--info">
                    当前没有追番记录
                  </span>
                )}
              </div>
            ) : (
              <div className="settings-view__confirm" role="alertdialog" aria-label="确认清空">
                <span className="settings-view__confirm-text">
                  确定清空所有 {animeCount} 部追番记录？此操作不可撤销。
                </span>
                <div className="settings-view__confirm-actions">
                  <button
                    type="button"
                    className="settings-view__button"
                    onClick={handleCancelClear}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="settings-view__button settings-view__button--danger-confirm"
                    onClick={handleConfirmClear}
                    autoFocus
                  >
                    确认清空
                  </button>
                </div>
              </div>
            )}
            {clearStatus && (
              <p
                className={`settings-view__status settings-view__status--${clearStatus.kind}`}
                role={clearStatus.kind === 'error' ? 'alert' : 'status'}
              >
                {clearStatus.text}
              </p>
            )}
          </section>

          {/* —— 关于 / Credits —— */}
          <section className="settings-view__card" aria-label="关于">
            <h2 className="settings-view__card-heading">关于 Pochan</h2>
            <div className="settings-view__credits">
              <p className="settings-view__credits-version">v0.1.0</p>
              <p className="settings-view__credits-desc">
                一个本地优先的追番气泡工具。
              </p>
              <div className="settings-view__credits-list">
                <div className="settings-view__credits-item">
                  <span className="settings-view__credits-role">开发</span>
                  <span className="settings-view__credits-name">Lavr0v0</span>
                </div>
                <div className="settings-view__credits-item">
                  <span className="settings-view__credits-role">框架</span>
                  <span className="settings-view__credits-name">Tauri + React + TypeScript</span>
                </div>
                <div className="settings-view__credits-item">
                  <span className="settings-view__credits-role">物理引擎</span>
                  <span className="settings-view__credits-name">Matter.js</span>
                </div>
                <div className="settings-view__credits-item">
                  <span className="settings-view__credits-role">数据源</span>
                  <a
                    className="settings-view__credits-link"
                    href="https://bgm.tv"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Bangumi 番组计划
                  </a>
                </div>
                <div className="settings-view__credits-item">
                  <span className="settings-view__credits-role">源码</span>
                  <a
                    className="settings-view__credits-link"
                    href="https://github.com/Lavr0v0/Pochan"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub
                  </a>
                </div>
                <div className="settings-view__credits-item">
                  <span className="settings-view__credits-role">许可证</span>
                  <span className="settings-view__credits-name">MIT</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default SettingsView;
