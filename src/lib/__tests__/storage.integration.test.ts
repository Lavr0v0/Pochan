/**
 * Phase 1 端到端集成验证（任务 1.9）
 *
 * 由于本环境缺少 Rust 工具链，无法直接 `npm run tauri dev` 启动真实窗口
 * 来验证「添加假数据 → 重启应用 → 数据仍在 → anime.json 文件确实写入」。
 * 这里以一个**等价的**集成测试代替：用一个内存 StorageAdapter 同时充当
 *
 *   1. 「磁盘」（save 写入字符串、load 读出字符串）
 *   2. 「重启」（构造第二个独立 store，复用同一个内存 adapter，调用
 *      loadFromDisk 后验证数据仍在）
 *
 * 这样既验证了 createDebouncedSaver 的写入路径，也验证了
 * createAnimeStore 的 loadFromDisk 路径，覆盖 Requirement 6.1 / 6.3：
 *
 *   - 6.1 启动时从持久化层读取 anime.json
 *   - 6.3 每次保存整体覆盖写入 anime.json
 *
 * 真实 Tauri 窗口下的人工冒烟（启动 → 添加假番 → 关闭 → 重启 → 验证）
 * 留待 Rust 工具链可用时再补，与 1.1 / 1.2 中的 cargo 限制一致。
 */

import { describe, expect, it } from 'vitest';
import { createAnimeStore } from '../../store/useAnimeStore';
import type { StorageAdapter } from '../storage';
import type { AnimeFile, TrackedAnime } from '../../types';

// ---------------------------------------------------------------------------
// 内存 StorageAdapter
// ---------------------------------------------------------------------------

/**
 * 工厂：返回一个把整个 anime.json 内容存在闭包内字符串中的 adapter，
 * 加上 `peek()` / `peekFile()` 探针供测试断言「磁盘」上的当前内容，
 * 以及 `saveCount` 统计真实写入次数（验证 debounce）。
 */
function makeMemoryAdapter() {
  let stored: string | null = null;
  let saveCount = 0;

  const adapter: StorageAdapter = {
    async load() {
      if (stored === null) {
        return { version: 1, animes: [] };
      }
      // 对应真实 tauriLoad：JSON.parse 后直接返回（这里直接信任内存内容）
      return JSON.parse(stored) as AnimeFile;
    },
    async save(file) {
      saveCount += 1;
      stored = JSON.stringify(file);
    },
    exportJson(file) {
      return JSON.stringify(file);
    },
    importJson(json) {
      return JSON.parse(json) as AnimeFile;
    },
  };

  return {
    adapter,
    /** 返回「磁盘」上的原始字符串（`null` 表示尚未写过） */
    peek: () => stored,
    /** 返回解析后的 AnimeFile（未写入时返回空容器） */
    peekFile: (): AnimeFile =>
      stored === null ? { version: 1, animes: [] } : (JSON.parse(stored) as AnimeFile),
    /** 真实 adapter.save 被调用的次数 */
    getSaveCount: () => saveCount,
  };
}

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------

/** 一条假番剧（最小必填字段全部齐全，可通过 schema 校验） */
function makeFakeAnime(overrides: Partial<TrackedAnime> = {}): TrackedAnime {
  return {
    id: 1,
    name: 'TEST_ORIGINAL',
    nameCn: '测试番剧',
    cover: 'https://lain.bgm.tv/pic/cover/l/test.jpg',
    totalEpisodes: 12,
    watchedEpisodes: 0,
    // addAnime 会用 now() 覆盖这两个字段；写在这里只是为了类型完整。
    lastWatchedAt: '1970-01-01T00:00:00.000Z',
    addedAt: '1970-01-01T00:00:00.000Z',
    status: 'airing',
    airDay: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe('Phase 1 端到端集成验证（任务 1.9）', () => {
  it('保存假番剧后，「重启」应用数据仍在，且 anime.json 内容正确', async () => {
    const memory = makeMemoryAdapter();

    // ---- 第一次会话：模拟用户在 app 里点了「添加假番剧」按钮 ----
    const sessionA = createAnimeStore({
      adapter: memory.adapter,
      // delayMs=0 配合 flushPending 让写盘几乎是同步完成
      delayMs: 0,
      attachWindowFlush: false,
    });

    // 初始磁盘上没有任何文件
    expect(memory.peek()).toBeNull();

    sessionA.getState().addAnime(makeFakeAnime());

    // 等待 debounced saver 触发并 flush 到「磁盘」
    await sessionA.getState().flushPending();

    // ---- 验证「anime.json」被写入 ----
    const writtenRaw = memory.peek();
    expect(writtenRaw).not.toBeNull();

    const writtenFile = memory.peekFile();
    expect(writtenFile.version).toBe(1);
    expect(writtenFile.animes).toHaveLength(1);
    expect(writtenFile.animes[0].id).toBe(1);
    expect(writtenFile.animes[0].name).toBe('TEST_ORIGINAL');
    expect(writtenFile.animes[0].nameCn).toBe('测试番剧');
    // addAnime 应当把 addedAt 与 lastWatchedAt 都覆盖为 now()
    expect(writtenFile.animes[0].addedAt).not.toBe('1970-01-01T00:00:00.000Z');
    expect(writtenFile.animes[0].lastWatchedAt).toBe(writtenFile.animes[0].addedAt);

    // ---- 第二次会话：模拟用户重启应用（同一个「磁盘」） ----
    const sessionB = createAnimeStore({
      adapter: memory.adapter,
      delayMs: 0,
      attachWindowFlush: false,
    });

    // 重启后默认 store 为空、isLoaded=false
    expect(sessionB.getState().animes).toEqual([]);
    expect(sessionB.getState().isLoaded).toBe(false);

    await sessionB.getState().loadFromDisk();

    // 加载后 isLoaded=true，且数据与第一次会话写入的一致
    expect(sessionB.getState().isLoaded).toBe(true);
    expect(sessionB.getState().animes).toHaveLength(1);
    expect(sessionB.getState().animes[0]).toEqual(writtenFile.animes[0]);
  });

  it('单次 addAnime 在 flush 后只产生一次磁盘写入（覆盖 Requirement 6.3 整体覆盖写）', async () => {
    const memory = makeMemoryAdapter();
    const store = createAnimeStore({
      adapter: memory.adapter,
      delayMs: 0,
      attachWindowFlush: false,
    });

    store.getState().addAnime(makeFakeAnime({ id: 42 }));
    await store.getState().flushPending();

    expect(memory.getSaveCount()).toBe(1);
    expect(memory.peekFile().animes.map((a) => a.id)).toEqual([42]);
  });
});
