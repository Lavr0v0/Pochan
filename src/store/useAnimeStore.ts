/**
 * Anime_Store：基于 Zustand 的全局追番状态。
 *
 * 实现 design.md "Components and Interfaces / Store (Zustand)"
 * 与 requirements.md Requirements 1.7 / 2.1 / 2.8 / 2.9 / 5.6 / 5.7 / 6.4 / 6.5 / 10.2 / 10.7。
 *
 * 关键性质（Properties 7、8、12、13、19）：
 *   - addAnime(a)：长度 +1，且 a.addedAt === a.lastWatchedAt === now()
 *   - incrementWatched(id)：watched += 1，lastWatchedAt 严格递增
 *   - markFinished(id)：status = 'finished'，watched = totalEpisodes
 *   - removeAnime(id) / removeMany(ids)：保留剩余项原顺序
 *   - updateAnime(id, patch)：浅合并 patch
 *
 * 设计要点：
 *   1. createAnimeStore(deps) 工厂支持依赖注入（adapter / saverFactory），
 *      让单元测试可以替换为内存 adapter。
 *   2. 任意 mutation 后调用 saver(file)，由 saver 在 500ms 内 debounce 写盘。
 *   3. loadFromDisk 完成后 isLoaded = true，但不触发 save（避免把刚读出来的数据立刻又写回去）。
 *   4. 默认在浏览器环境中注册 beforeunload 监听以 flush pending 数据；
 *      测试可通过 `attachWindowFlush: false` 关闭以隔离副作用。
 *   5. importJson 直接抛出 adapter.importJson 的错误，让 SettingsView 自行展示。
 */

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { AnimeFile, TrackedAnime } from '../types';
import {
  createDebouncedSaver,
  tauriStorageAdapter,
  type DebouncedSaver,
  type StorageAdapter,
} from '../lib/storage';
import { eventBus } from '../lib/eventBus';

// ---------------------------------------------------------------------------
// adapter 包装：捕获 save 失败并 emit 'storage:error'
// ---------------------------------------------------------------------------

/** 磁盘写入失败时显示给用户的统一文案（design.md 错误场景 4） */
const STORAGE_ERROR_MESSAGE = '保存失败，请检查磁盘空间';

/**
 * 把任意 StorageAdapter 包成「失败时通知 eventBus」的 adapter。
 *
 * 设计要点：
 *   - 仅包 `save`：load / exportJson / importJson 的错误已有对应 UI 处理
 *     （加载失败走损坏文件备份、导入失败由 SettingsView 显示）
 *   - 包装后仍向上抛出原错误，便于上层 saver 链感知失败；同时 emit 一条 toast
 *   - 不在 emit 中读取 `e.message`：原生错误信息可能是英文 / 含路径，对终端用户
 *     不友好；使用统一中文文案（与设计文档一致）
 *   - 函数本身是纯包装，不持有状态，可直接在 createAnimeStore 中调用
 */
function wrapAdapterWithErrorBus(adapter: StorageAdapter): StorageAdapter {
  return {
    load: () => adapter.load(),
    save: async (file) => {
      try {
        await adapter.save(file);
      } catch (e) {
        eventBus.emit('storage:error', { message: STORAGE_ERROR_MESSAGE });
        throw e;
      }
    },
    exportJson: (file) => adapter.exportJson(file),
    importJson: (json) => adapter.importJson(json),
  };
}

// ---------------------------------------------------------------------------
// Store 接口（与 design.md 一致）
// ---------------------------------------------------------------------------

export interface AnimeStore {
  // —— 状态 ——
  animes: TrackedAnime[];
  isLoaded: boolean;

  // —— 加载 ——
  loadFromDisk: () => Promise<void>;

  // —— Mutations ——
  addAnime: (anime: TrackedAnime) => void;
  updateAnime: (id: number, patch: Partial<TrackedAnime>) => void;
  removeAnime: (id: number) => void;
  removeMany: (ids: number[]) => void;
  incrementWatched: (id: number) => void;
  decrementWatched: (id: number) => void;
  markFinished: (id: number) => void;

  // —— 导入 / 导出 / 清空 ——
  exportJson: () => string;
  importJson: (json: string) => void;
  clearAll: () => void;

  // —— Lifecycle ——
  /** 立即把 pending 写盘任务 flush 到磁盘 */
  flushPending: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// 工厂依赖注入
// ---------------------------------------------------------------------------

export interface AnimeStoreDeps {
  /** 存储适配器；缺省使用 tauriStorageAdapter */
  adapter?: StorageAdapter;
  /** debounced saver 工厂；缺省使用 createDebouncedSaver */
  saverFactory?: (adapter: StorageAdapter, delayMs?: number) => DebouncedSaver;
  /** debounce 延迟（ms），缺省 500 */
  delayMs?: number;
  /**
   * 是否在 window 上注册 beforeunload 监听以 flush pending 数据。
   *
   * 缺省值为 `true`：仅在 `attachWindowFlush !== false` 且
   * `typeof window !== 'undefined'` 时才注册。测试场景请显式传 `false`
   * 以避免与默认 singleton store 同时挂监听造成污染。
   */
  attachWindowFlush?: boolean;
}

// ---------------------------------------------------------------------------
// 工具：构造当前 AnimeFile 快照供 saver
// ---------------------------------------------------------------------------

function snapshot(animes: TrackedAnime[]): AnimeFile {
  return { version: 1, animes };
}

/**
 * 计算严格递增的 ISO 时间戳。
 *
 * Property 7 要求 incrementWatched 后 `lastWatchedAt > prev.lastWatchedAt`。
 * 由于多次调用可能落在同一毫秒内，这里取 `max(now, prev + 1ms)` 保证严格递增。
 */
function nextWatchedAt(prevIso: string): string {
  const prev = Date.parse(prevIso);
  const now = Date.now();
  const next = Number.isFinite(prev) ? Math.max(now, prev + 1) : now;
  return new Date(next).toISOString();
}

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

export type AnimeStoreHook = UseBoundStore<StoreApi<AnimeStore>>;

/**
 * 创建一个 AnimeStore 实例。
 *
 * 默认无参调用即可得到生产 store；测试可注入内存 adapter：
 *
 *   const store = createAnimeStore({ adapter: memoryAdapter, delayMs: 0 });
 */
export function createAnimeStore(deps: AnimeStoreDeps = {}): AnimeStoreHook {
  // `adapter` 用于 load / exportJson / importJson 等读取路径，错误由调用方处理；
  // `savingAdapter` 是 wrap 后的版本，仅供 debounced saver 使用——写入失败时
  // 会通过 eventBus 弹出全局 toast，与 design.md 错误场景 4 一致。
  const adapter = deps.adapter ?? tauriStorageAdapter;
  const savingAdapter = wrapAdapterWithErrorBus(adapter);
  const factory = deps.saverFactory ?? createDebouncedSaver;
  const delayMs = deps.delayMs ?? 500;
  const saver = factory(savingAdapter, delayMs);

  // 是否挂 beforeunload：默认在浏览器环境中注册，除非显式传 false。
  const shouldAttach =
    deps.attachWindowFlush !== false && typeof window !== 'undefined';

  const useStore = create<AnimeStore>((set, get) => {
    /** 持久化当前 store 到 saver（debounced） */
    const persist = (animes: TrackedAnime[]): void => {
      saver(snapshot(animes));
    };

    return {
      animes: [],
      isLoaded: false,

      // ---------------------------------------------------------------------
      // 加载
      // ---------------------------------------------------------------------
      loadFromDisk: async () => {
        const file = await adapter.load();
        // 注意：不调用 saver；刚读出的数据无需立刻回写
        set({ animes: file.animes, isLoaded: true });
      },

      // ---------------------------------------------------------------------
      // Mutations
      // ---------------------------------------------------------------------

      /**
       * 添加新番。
       *
       * Property 19：长度 +1，addedAt = lastWatchedAt = now()。
       * Requirement 1.7 EARS 显式要求两个时间戳都设为当前时间，
       * 因此即使调用方传入了它们，也以 now() 覆盖。
       */
      addAnime: (anime) => {
        const now = new Date().toISOString();
        const created: TrackedAnime = {
          ...anime,
          addedAt: now,
          lastWatchedAt: now,
          // 默认进入「在看」状态（如果调用方未指定）
          watchStatus: anime.watchStatus ?? 'watching',
        };
        const animes = [...get().animes, created];
        set({ animes });
        persist(animes);
      },

      /** 浅合并 patch，id 不存在时 noop */
      updateAnime: (id, patch) => {
        const prev = get().animes;
        let changed = false;
        const animes = prev.map((a) => {
          if (a.id !== id) return a;
          changed = true;
          return { ...a, ...patch };
        });
        if (!changed) return;
        set({ animes });
        persist(animes);
      },

      removeAnime: (id) => {
        const prev = get().animes;
        const animes = prev.filter((a) => a.id !== id);
        if (animes.length === prev.length) return;
        set({ animes });
        persist(animes);
      },

      /**
       * 批量删除。
       *
       * Property 12：剩余顺序保持原列表顺序；不在传入集合的元素全部保留。
       */
      removeMany: (ids) => {
        if (ids.length === 0) return;
        const remove = new Set(ids);
        const prev = get().animes;
        const animes = prev.filter((a) => !remove.has(a.id));
        if (animes.length === prev.length) return;
        set({ animes });
        persist(animes);
      },

      /**
       * 看了一集。不能超过 totalEpisodes（totalEpisodes > 0 时）。
       * 如果已经看完（watched >= total），不做任何操作。
       */
      incrementWatched: (id) => {
        const prev = get().animes;
        let changed = false;
        const animes = prev.map((a) => {
          if (a.id !== id) return a;
          // 已看完，不能再加
          if (a.totalEpisodes > 0 && a.watchedEpisodes >= a.totalEpisodes) return a;
          changed = true;
          return {
            ...a,
            watchedEpisodes: a.watchedEpisodes + 1,
            lastWatchedAt: nextWatchedAt(a.lastWatchedAt),
          };
        });
        if (!changed) return;
        set({ animes });
        persist(animes);
      },

      /**
       * 撤回一集（右键操作）。不能低于 0。
       */
      decrementWatched: (id) => {
        const prev = get().animes;
        let changed = false;
        const animes = prev.map((a) => {
          if (a.id !== id) return a;
          if (a.watchedEpisodes <= 0) return a;
          changed = true;
          return {
            ...a,
            watchedEpisodes: a.watchedEpisodes - 1,
          };
        });
        if (!changed) return;
        set({ animes });
        persist(animes);
      },

      /**
       * Property 8：status='finished'，watched=totalEpisodes，其他字段保留。
       */
      markFinished: (id) => {
        const prev = get().animes;
        let changed = false;
        const animes: TrackedAnime[] = prev.map((a) => {
          if (a.id !== id) return a;
          changed = true;
          return {
            ...a,
            status: 'finished' as const,
            watchedEpisodes: a.totalEpisodes,
          };
        });
        if (!changed) return;
        set({ animes });
        persist(animes);
      },

      // ---------------------------------------------------------------------
      // 导入 / 导出 / 清空
      // ---------------------------------------------------------------------

      exportJson: () => {
        return adapter.exportJson(snapshot(get().animes));
      },

      /**
       * 同步替换 animes；adapter.importJson 抛出的错误向上抛出，
       * 由 SettingsView 等调用方负责展示。
       */
      importJson: (json) => {
        const file = adapter.importJson(json); // 不合法时抛错
        const animes = file.animes;
        set({ animes });
        persist(animes);
      },

      clearAll: () => {
        if (get().animes.length === 0) return;
        set({ animes: [] });
        persist([]);
      },

      // ---------------------------------------------------------------------
      // Lifecycle
      // ---------------------------------------------------------------------

      flushPending: async () => {
        await saver.flush();
      },
    };
  });

  // 浏览器环境下挂 beforeunload，flush 任何 pending 写盘
  if (shouldAttach) {
    window.addEventListener('beforeunload', () => {
      void useStore.getState().flushPending();
    });
  }

  return useStore;
}

// ---------------------------------------------------------------------------
// 默认 singleton
// ---------------------------------------------------------------------------

export const useAnimeStore: AnimeStoreHook = createAnimeStore();
