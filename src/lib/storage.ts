/**
 * Storage 层：本地持久化（anime.json）
 *
 * 实现 design.md "Storage Layer" 与 requirements.md Requirement 6 / 10。
 *
 * 关键性质：
 *   - load() 在文件缺失时返回空容器（不抛错）。
 *   - load() 在 JSON 解析或 schema 校验失败时，将原文件重命名为
 *     `anime.broken.{timestamp}.json` 并返回空容器（不抛错）。
 *   - save() 整体覆盖写。
 *   - createDebouncedSaver(adapter, 500) 在 500ms burst 窗口内只做一次写盘，
 *     使用最新状态（Property 18）。
 *   - importJson() 同步抛出，含具体字段错误信息（Requirement 10.5/10.6）。
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.5, 6.7, 6.8, 10.5
 */

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  rename,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import type { AnimeFile, AnimeGoal, TrackedAnime } from '../types';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 持久化文件名（位于 BaseDirectory.AppData 下） */
export const ANIME_FILE_NAME = 'anime.json';

/** 空容器（解析失败 / 文件不存在时使用） */
export const EMPTY_ANIME_FILE: AnimeFile = { version: 1, animes: [] };

// ---------------------------------------------------------------------------
// Schema 校验
// ---------------------------------------------------------------------------

/**
 * 校验上下文：用于在 type guard 中累积可读错误信息。
 *
 * 我们没有把 errors 作为 type guard 的副作用（因为 type guard 必须返回布尔），
 * 而是把信息收集封装到 `validateAnimeFile` 中，再由 `importJson` 转抛。
 */
interface ValidationContext {
  errors: string[];
  path: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function checkGoal(value: unknown, ctx: ValidationContext, path: string): value is AnimeGoal {
  if (!isPlainObject(value)) {
    ctx.errors.push(`${path}: goal 必须为对象`);
    return false;
  }
  let ok = true;
  if (!isFiniteNumber(value.targetEpisodes) || (value.targetEpisodes as number) < 1) {
    ctx.errors.push(`${path}.targetEpisodes: 必须为 ≥ 1 的数字`);
    ok = false;
  }
  if (typeof value.deadline !== 'string' || value.deadline.length === 0) {
    ctx.errors.push(`${path}.deadline: 必须为非空字符串（ISO 日期）`);
    ok = false;
  }
  return ok;
}

/**
 * 校验单条 TrackedAnime。
 *
 * 字段约束（详见 design.md "Data Models / TrackedAnime" 与 task 注 4）：
 *   - id: number, ≥ 1
 *   - name: string
 *   - nameCn: string
 *   - cover: string
 *   - totalEpisodes: number, ≥ 0
 *   - watchedEpisodes: number, ≥ 0
 *   - lastWatchedAt: string
 *   - addedAt: string
 *   - status: 'airing' | 'finished'
 *   - airDay?: number 0-6
 *   - airTime?: string
 *   - goal?: { targetEpisodes ≥ 1, deadline string }
 *   - color?: string
 *   - notes?: string
 */
function validateTrackedAnime(
  value: unknown,
  ctx: ValidationContext,
  path: string,
): value is TrackedAnime {
  if (!isPlainObject(value)) {
    ctx.errors.push(`${path}: 必须为对象`);
    return false;
  }
  let ok = true;

  // —— 必填字段 ——
  if (!isFiniteNumber(value.id) || (value.id as number) < 1) {
    ctx.errors.push(`${path}.id: 必须为 ≥ 1 的数字`);
    ok = false;
  }
  if (typeof value.name !== 'string') {
    ctx.errors.push(`${path}.name: 必须为字符串`);
    ok = false;
  }
  if (typeof value.nameCn !== 'string') {
    ctx.errors.push(`${path}.nameCn: 必须为字符串`);
    ok = false;
  }
  if (typeof value.cover !== 'string') {
    ctx.errors.push(`${path}.cover: 必须为字符串`);
    ok = false;
  }
  if (!isFiniteNumber(value.totalEpisodes) || (value.totalEpisodes as number) < 0) {
    ctx.errors.push(`${path}.totalEpisodes: 必须为 ≥ 0 的数字`);
    ok = false;
  }
  if (!isFiniteNumber(value.watchedEpisodes) || (value.watchedEpisodes as number) < 0) {
    ctx.errors.push(`${path}.watchedEpisodes: 必须为 ≥ 0 的数字`);
    ok = false;
  }
  if (typeof value.lastWatchedAt !== 'string') {
    ctx.errors.push(`${path}.lastWatchedAt: 必须为字符串（ISO 时间戳）`);
    ok = false;
  }
  if (typeof value.addedAt !== 'string') {
    ctx.errors.push(`${path}.addedAt: 必须为字符串（ISO 时间戳）`);
    ok = false;
  }
  if (value.status !== 'airing' && value.status !== 'finished' && value.status !== 'upcoming') {
    ctx.errors.push(`${path}.status: 必须为 'airing'、'finished' 或 'upcoming'`);
    ok = false;
  }

  // —— 可选字段 ——
  if (value.airDay !== undefined) {
    if (
      !isFiniteInteger(value.airDay) ||
      (value.airDay as number) < 0 ||
      (value.airDay as number) > 6
    ) {
      ctx.errors.push(`${path}.airDay: 若提供，必须为 0-6 的整数`);
      ok = false;
    }
  }
  if (value.airTime !== undefined && typeof value.airTime !== 'string') {
    ctx.errors.push(`${path}.airTime: 若提供，必须为字符串`);
    ok = false;
  }
  if (value.goal !== undefined) {
    if (!checkGoal(value.goal, ctx, `${path}.goal`)) {
      ok = false;
    }
  }
  if (value.color !== undefined && typeof value.color !== 'string') {
    ctx.errors.push(`${path}.color: 若提供，必须为字符串`);
    ok = false;
  }
  if (value.notes !== undefined && typeof value.notes !== 'string') {
    ctx.errors.push(`${path}.notes: 若提供，必须为字符串`);
    ok = false;
  }
  if (value.watchStatus !== undefined) {
    const ws = value.watchStatus;
    if (ws !== 'plan' && ws !== 'watching' && ws !== 'completed' && ws !== 'dropped') {
      ctx.errors.push(
        `${path}.watchStatus: 若提供，必须为 'plan' | 'watching' | 'completed' | 'dropped'`,
      );
      ok = false;
    }
  }
  if (value.summary !== undefined && typeof value.summary !== 'string') {
    ctx.errors.push(`${path}.summary: 若提供，必须为字符串`);
    ok = false;
  }

  return ok;
}

/** 校验 AnimeFile（顶层容器） */
function validateAnimeFile(value: unknown, ctx: ValidationContext): value is AnimeFile {
  if (!isPlainObject(value)) {
    ctx.errors.push(`${ctx.path}: 必须为对象`);
    return false;
  }
  let ok = true;
  if (value.version !== 1) {
    ctx.errors.push(`${ctx.path}.version: 必须为 1`);
    ok = false;
  }
  if (!Array.isArray(value.animes)) {
    ctx.errors.push(`${ctx.path}.animes: 必须为数组`);
    ok = false;
  } else {
    value.animes.forEach((item, idx) => {
      if (!validateTrackedAnime(item, ctx, `${ctx.path}.animes[${idx}]`)) {
        ok = false;
      }
    });
  }
  return ok;
}

/**
 * 公共 type guard：value 是合法的 TrackedAnime 吗？
 *
 * 不暴露错误信息；如需详细错误，请走 importJson 流程。
 */
export function isValidTrackedAnime(value: unknown): value is TrackedAnime {
  return validateTrackedAnime(value, { errors: [], path: '$' }, '$');
}

/**
 * 公共 type guard：value 是合法的 AnimeFile 吗？
 */
export function isValidAnimeFile(value: unknown): value is AnimeFile {
  return validateAnimeFile(value, { errors: [], path: '$' });
}

// ---------------------------------------------------------------------------
// 损坏文件备份
// ---------------------------------------------------------------------------

/**
 * 生成损坏文件备份名：`anime.broken.{ISO timestamp}.json`，
 * 时间戳中的 `:` 与 `.` 替换为 `-` 以避免 Windows 文件名非法字符。
 */
function makeBrokenFileName(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `anime.broken.${stamp}.json`;
}

/**
 * 将损坏的 anime.json 重命名为带时间戳的备份。
 *
 * 只在文件存在时尝试；任何失败均吞掉错误（不影响调用方继续以空容器启动）。
 */
async function backupBrokenFile(): Promise<void> {
  try {
    const present = await exists(ANIME_FILE_NAME, { baseDir: BaseDirectory.AppData });
    if (!present) return;
    await rename(ANIME_FILE_NAME, makeBrokenFileName(), {
      oldPathBaseDir: BaseDirectory.AppData,
      newPathBaseDir: BaseDirectory.AppData,
    });
  } catch {
    // best-effort：备份失败不应阻塞应用启动
  }
}

// ---------------------------------------------------------------------------
// StorageAdapter 接口
// ---------------------------------------------------------------------------

/**
 * 存储适配器：抽象出文件 IO 以便在测试中替换为内存实现。
 *
 * 详见 design.md "Storage Layer / 接口"。
 */
export interface StorageAdapter {
  /** 从磁盘加载 AnimeFile；不存在或损坏时返回空容器，不抛错 */
  load(): Promise<AnimeFile>;
  /** 整体覆盖写入 anime.json */
  save(file: AnimeFile): Promise<void>;
  /** 将当前 AnimeFile 序列化为字符串（同步） */
  exportJson(file: AnimeFile): string;
  /** 解析 + 校验导入字符串；不合法时同步抛错 */
  importJson(json: string): AnimeFile;
}

// ---------------------------------------------------------------------------
// 默认实现：通过 @tauri-apps/plugin-fs 操作 BaseDirectory.AppData
// ---------------------------------------------------------------------------

async function tauriLoad(): Promise<AnimeFile> {
  const present = await exists(ANIME_FILE_NAME, { baseDir: BaseDirectory.AppData });
  if (!present) {
    return { version: 1, animes: [] };
  }

  let text: string;
  try {
    text = await readTextFile(ANIME_FILE_NAME, { baseDir: BaseDirectory.AppData });
  } catch {
    // 读不到文本（权限/编码异常）：当作损坏处理
    await backupBrokenFile();
    return { version: 1, animes: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    await backupBrokenFile();
    return { version: 1, animes: [] };
  }

  if (!isValidAnimeFile(parsed)) {
    await backupBrokenFile();
    return { version: 1, animes: [] };
  }

  return parsed;
}

async function tauriSave(file: AnimeFile): Promise<void> {
  if (!isValidAnimeFile(file)) {
    // 防御：不允许把损坏的内存状态写到磁盘
    throw new Error('storage.save: refusing to write invalid AnimeFile');
  }
  // 确保 AppData 目录存在（首次运行时可能还没创建）
  try {
    const dirExists = await exists('', { baseDir: BaseDirectory.AppData });
    if (!dirExists) {
      await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true });
    }
  } catch {
    // 目录已存在或无法检测，继续尝试写入
  }
  const text = JSON.stringify(file, null, 2);
  await writeTextFile(ANIME_FILE_NAME, text, { baseDir: BaseDirectory.AppData });
}

function exportJsonImpl(file: AnimeFile): string {
  return JSON.stringify(file, null, 2);
}

function importJsonImpl(json: string): AnimeFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`import: invalid schema: 不是合法 JSON (${detail})`);
  }
  const ctx: ValidationContext = { errors: [], path: '$' };
  if (!validateAnimeFile(parsed, ctx)) {
    throw new Error(`import: invalid schema: ${ctx.errors.join('; ')}`);
  }
  return parsed;
}

/** 默认基于 Tauri plugin-fs 的存储适配器 */
export const tauriStorageAdapter: StorageAdapter = {
  load: tauriLoad,
  save: tauriSave,
  exportJson: exportJsonImpl,
  importJson: importJsonImpl,
};

// ---------------------------------------------------------------------------
// Debounced saver（Property 18）
// ---------------------------------------------------------------------------

/**
 * 带 flush 能力的 debounced saver。
 *
 * 调用方式：
 *   const save = createDebouncedSaver(adapter, 500);
 *   save(file);          // 不会立刻写盘
 *   save(file2);         // 仍未写盘
 *   await save.flush();  // 立刻把最新 file2 写入磁盘
 *
 * 性质（Property 18）：
 *   - 在 [t, t + delayMs) 的 burst 内多次调用仅触发 1 次磁盘写入。
 *   - 最终写入内容是最后一次调用传入的 AnimeFile。
 *   - flush() 在没有 pending 数据时立即 resolve；有时则提前完成写入。
 */
export interface DebouncedSaver {
  (file: AnimeFile): void;
  /** 立即把当前 pending 的 AnimeFile 写入磁盘；无 pending 时为 noop */
  flush: () => Promise<void>;
}

export function createDebouncedSaver(
  adapter: StorageAdapter,
  delayMs = 500,
): DebouncedSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: AnimeFile | null = null;
  // 串行化所有 adapter.save 调用，避免两次写入交叉
  let writing: Promise<void> = Promise.resolve();

  /**
   * 立即取走 pending 并写盘，结果挂在串行的 writing 链上。
   * 即使 adapter.save 抛错也不打断后续写入（错误向上层冒泡需走 flush）。
   */
  const drain = (): Promise<void> => {
    if (pending === null) return writing;
    const snapshot = pending;
    pending = null;
    writing = writing.then(
      () => adapter.save(snapshot),
      () => adapter.save(snapshot),
    );
    return writing;
  };

  const enqueue = (file: AnimeFile): void => {
    pending = file;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      // 触发后台写盘；不 await，错误也不抛回 timer 回调
      void drain().catch(() => {
        /* 错误已被吞掉，下一次 flush 才会再次冒泡 */
      });
    }, delayMs);
  };

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    // 把任何 pending 数据加入写入链
    drain();
    // 等待整条链完成（包含可能正在进行的旧写入）
    await writing;
  };

  // 把 flush 挂到调用函数上，保证 saver.flush() 可用
  const fn = enqueue as DebouncedSaver;
  fn.flush = flush;
  return fn;
}

// ---------------------------------------------------------------------------
// 顶层便捷函数（部分调用方喜欢直接用函数而非 adapter）
// ---------------------------------------------------------------------------

/** 等价于 `tauriStorageAdapter.load()` */
export function load(): Promise<AnimeFile> {
  return tauriStorageAdapter.load();
}

/** 等价于 `tauriStorageAdapter.save(file)` */
export function save(file: AnimeFile): Promise<void> {
  return tauriStorageAdapter.save(file);
}

/** 把当前 AnimeFile 序列化为字符串，供「导出 JSON」使用 */
export function exportJson(file: AnimeFile): string {
  return exportJsonImpl(file);
}

/** 解析 + 校验导入字符串，供「导入 JSON」使用；不合法时同步抛错 */
export function importJson(json: string): AnimeFile {
  return importJsonImpl(json);
}
