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

import { useCallback, useEffect, useRef, useState } from 'react';

import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

import { useAnimeStore } from '../store/useAnimeStore';
import { importFromBangumi, BangumiError } from '../lib/bangumi';
import { applyTheme, getStoredTheme, setStoredTheme, getUnlockedThemes, checkAndUnlockThemes, unlockPinkTheme, redeemGoldTheme, THEME_UNLOCK_CONDITIONS, SPECIAL_THEMES } from '../lib/theme';
import { resetTutorial } from '../components/Tutorial';
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

  // —— 清空确认流程 ——
  type ClearTarget = 'all' | 'preferences' | 'animes' | 'history';
  type ClearStage = 'idle' | 'first' | 'final';
  const [clearTarget, setClearTarget] = useState<ClearTarget | null>(null);
  const [clearStage, setClearStage] = useState<ClearStage>('idle');

  // —— Bangumi 导入 ——
  const [bangumiUsername, setBangumiUsername] = useState<string>('');
  const [bangumiImporting, setBangumiImporting] = useState<boolean>(false);
  const [bangumiStatus, setBangumiStatus] = useState<StatusMessage | null>(null);

  // —— 主题切换 ——
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const [unlockedThemes, setUnlockedThemes] = useState<ThemeMode[]>(() => getUnlockedThemes());
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemStatus, setRedeemStatus] = useState<string | null>(null);

  // 检查解锁条件
  const completedCount = animes.filter((a) => (a.watchStatus ?? 'watching') === 'completed').length;
  const totalWatchedEpisodes = animes.reduce((sum, a) => sum + a.watchedEpisodes, 0);

  // 重置个性化后禁止自动解锁（直到组件重新挂载）
  const autoUnlockDisabledRef = useRef(false);

  useEffect(() => {
    if (autoUnlockDisabledRef.current) return;
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

  const handleRedeem = useCallback(() => {
    if (redeemGoldTheme(redeemCode)) {
      setUnlockedThemes(getUnlockedThemes());
      setRedeemStatus('解锁成功！');
      setRedeemCode('');
    } else if (redeemCode.trim().length === 0) {
      setRedeemStatus(null);
    } else {
      setRedeemStatus('兑换码无效');
    }
  }, [redeemCode]);

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
  // 清空数据（多类型 + 两步确认）
  //
  // 流程：
  //   1. 点击某种清空按钮 → 进入 'first' 阶段（显示：取消 / 备份 / 继续清理）
  //   2. 点击「备份」→ 执行导出，然后进入 'final' 阶段
  //   3. 点击「继续清理」→ 直接进入 'final' 阶段
  //   4. 'final' 阶段：最终确认（取消 / 确认清空）
  //   5. 确认 → 执行对应清空操作
  // -------------------------------------------------------------------------

  const handleRequestClear = useCallback((target: 'all' | 'preferences' | 'animes' | 'history') => {
    setClearStatus(null);
    setClearTarget(target);
    setClearStage('first');
  }, []);

  const handleClearCancel = useCallback(() => {
    setClearTarget(null);
    setClearStage('idle');
  }, []);

  const handleClearBackupThenConfirm = useCallback(async () => {
    // 先执行备份
    try {
      const path = await save({
        defaultPath: defaultExportFileName(),
        filters: [{ name: JSON_FILTER.name, extensions: [...JSON_FILTER.extensions] }],
      });
      if (path === null || path === undefined) {
        // 用户取消了备份对话框，回到 first 阶段
        return;
      }
      const content = exportJson();
      await writeTextFile(path, content);
    } catch (err) {
      setClearStatus({ kind: 'error', text: `备份失败：${toErrorMessage(err)}` });
      return;
    }
    // 备份成功，进入最终确认
    setClearStage('final');
  }, [exportJson]);

  const handleClearContinue = useCallback(() => {
    setClearStage('final');
  }, []);

  const handleClearConfirm = useCallback(() => {
    const target = clearTarget;
    if (!target) return;

    switch (target) {
      case 'all':
        // 清空所有：番剧 + 历史 + 个性化
        clearAll();
        localStorage.removeItem('pochan-watch-history');
        localStorage.removeItem('pochan-theme');
        localStorage.removeItem('pochan-themes-unlocked');
        localStorage.removeItem('pochan-tutorial-completed');
        applyTheme('light');
        setTheme('light');
        autoUnlockDisabledRef.current = true;
        setUnlockedThemes([]);
        setClearStatus({ kind: 'success', text: '已清空所有数据' });
        break;
      case 'preferences':
        // 清空个性化设置：主题、解锁主题、新手引导标记
        localStorage.removeItem('pochan-theme');
        localStorage.removeItem('pochan-themes-unlocked');
        localStorage.removeItem('pochan-tutorial-completed');
        applyTheme('light');
        setTheme('light');
        autoUnlockDisabledRef.current = true;
        setUnlockedThemes([]);
        setClearStatus({ kind: 'success', text: '已重置个性化设置' });
        break;
      case 'animes':
        // 清空番剧数据
        clearAll();
        setClearStatus({ kind: 'success', text: '已清空番剧数据' });
        break;
      case 'history':
        // 清空观看历史
        localStorage.removeItem('pochan-watch-history');
        setClearStatus({ kind: 'success', text: '已清空统计数据' });
        break;
    }

    setClearTarget(null);
    setClearStage('idle');
  }, [clearTarget, clearAll]);

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  return (
    <div className="settings-view">
      <header className="settings-view__header">
        <h1 className="settings-view__title">设置</h1>
      </header>

      <div className="settings-view__body">
        <div className="settings-view__inner">
          {/* —— 外观 —— */}
          <section className="settings-view__card" aria-label="外观">
            <h2 className="settings-view__card-heading">外观</h2>
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
                    title={isUnlocked ? labels[t] : THEME_UNLOCK_CONDITIONS[t]}
                  >
                    {isUnlocked ? labels[t] : '???'}
                  </button>
                );
              })}
            </div>
            {!unlockedThemes.includes('gold') && (
              <div className="settings-view__actions" style={{ marginTop: '8px' }}>
                <input
                  type="text"
                  className="settings-view__input"
                  placeholder="兑换码"
                  value={redeemCode}
                  onChange={(e) => { setRedeemCode(e.target.value); setRedeemStatus(null); }}
                  style={{ width: '120px' }}
                />
                <button
                  type="button"
                  className="settings-view__button"
                  onClick={handleRedeem}
                  disabled={redeemCode.trim().length === 0}
                >
                  兑换
                </button>
                {redeemStatus && (
                  <span style={{ fontSize: '0.78rem', color: redeemStatus === '解锁成功！' ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {redeemStatus}
                  </span>
                )}
              </div>
            )}
          </section>

          {/* —— Bangumi —— */}
          <section className="settings-view__card" aria-label="Bangumi">
            <h2 className="settings-view__card-heading">Bangumi 导入</h2>
            <p className="settings-view__card-desc">
              输入公开 Bangumi 用户名，导入收藏列表。导入会追加到当前数据，不会覆盖已有记录。
            </p>
            <div className="settings-view__actions">
              <input
                type="text"
                className="settings-view__input"
                placeholder="用户名或 UID"
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
                {bangumiImporting ? '导入中…' : '导入 Bangumi 收藏'}
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

          {/* —— 数据 —— */}
          <section className="settings-view__card" aria-label="数据">
            <h2 className="settings-view__card-heading">数据</h2>
            <p className="settings-view__card-desc">
              数据只保存在本机。导出的 JSON 可用于备份或迁移。当前共 {animeCount} 部番剧。
            </p>
            <div className="settings-view__actions">
              <button
                type="button"
                className="settings-view__button settings-view__button--primary"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? '正在导出…' : '导出备份'}
              </button>
              <button
                type="button"
                className="settings-view__button"
                onClick={handleImport}
                disabled={importing}
              >
                {importing ? '正在导入…' : '恢复备份'}
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
            {importStatus && (
              <p
                className={`settings-view__status settings-view__status--${importStatus.kind}`}
                role={importStatus.kind === 'error' ? 'alert' : 'status'}
              >
                {importStatus.text}
              </p>
            )}

            <div className="settings-view__divider" />

            <h3 className="settings-view__card-subheading">清空数据</h3>

            {clearStage === 'idle' && (
              <div className="settings-view__clear-options">
                <button
                  type="button"
                  className="settings-view__button settings-view__button--danger"
                  onClick={() => handleRequestClear('all')}
                >
                  全部清空
                </button>
                <button
                  type="button"
                  className="settings-view__button settings-view__button--danger"
                  onClick={() => handleRequestClear('animes')}
                  disabled={animeCount === 0}
                >
                  清空番剧
                </button>
                <button
                  type="button"
                  className="settings-view__button settings-view__button--danger"
                  onClick={() => handleRequestClear('history')}
                >
                  清空统计数据
                </button>
                <button
                  type="button"
                  className="settings-view__button settings-view__button--danger"
                  onClick={() => handleRequestClear('preferences')}
                >
                  重置个性化
                </button>
              </div>
            )}

            {clearStage === 'first' && clearTarget && (
              <div className="settings-view__confirm" role="alertdialog" aria-label="清空确认第一步">
                <span className="settings-view__confirm-text">
                  {clearTarget === 'all' && '即将清空所有数据（番剧、统计、个性化设置），建议先备份。'}
                  {clearTarget === 'animes' && '即将清空所有番剧数据，建议先备份。'}
                  {clearTarget === 'history' && '即将清空所有观看统计数据，此操作不可撤销。'}
                  {clearTarget === 'preferences' && '即将重置所有个性化设置（主题、解锁进度、引导状态）。'}
                </span>
                <div className="settings-view__confirm-actions">
                  <button
                    type="button"
                    className="settings-view__button"
                    onClick={handleClearCancel}
                  >
                    取消
                  </button>
                  {(clearTarget === 'all' || clearTarget === 'animes') && (
                    <button
                      type="button"
                      className="settings-view__button settings-view__button--primary"
                      onClick={handleClearBackupThenConfirm}
                    >
                      先备份
                    </button>
                  )}
                  <button
                    type="button"
                    className="settings-view__button settings-view__button--danger"
                    onClick={handleClearContinue}
                  >
                    继续清理
                  </button>
                </div>
              </div>
            )}

            {clearStage === 'final' && clearTarget && (
              <div className="settings-view__confirm" role="alertdialog" aria-label="最终确认">
                <span className="settings-view__confirm-text">
                  确定要执行此操作吗？此操作无法撤销。
                </span>
                <div className="settings-view__confirm-actions">
                  <button
                    type="button"
                    className="settings-view__button"
                    onClick={handleClearCancel}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="settings-view__button settings-view__button--danger-confirm"
                    onClick={handleClearConfirm}
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

          {/* —— 关于 —— */}
          <section className="settings-view__card" aria-label="关于">
            <h2 className="settings-view__card-heading">关于</h2>
            <div className="settings-view__credits">
              <div className="settings-view__credits-list">
                <div className="settings-view__credits-item">
                  <span className="settings-view__credits-role">版本</span>
                  <span className="settings-view__credits-name settings-view__credits-mono">v0.2.7</span>
                </div>
                <div className="settings-view__credits-item">
                  <span className="settings-view__credits-role">开发</span>
                  <span className="settings-view__credits-name">Lavr0v0</span>
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
            <div className="settings-view__divider" />
            <div className="settings-view__actions">
              <button
                type="button"
                className="settings-view__button"
                onClick={() => {
                  resetTutorial();
                  window.dispatchEvent(new CustomEvent('pochan:restart-tutorial'));
                }}
              >
                重新引导
              </button>
              <span className="settings-view__card-desc" style={{ margin: 0 }}>
                重新查看新手引导教程
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default SettingsView;
