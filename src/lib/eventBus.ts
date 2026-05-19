/**
 * Event Bus：极简类型化全局事件总线，用于跨组件层（store ↔ UI）传递错误等
 * 「全局通知」事件，不让 store 反过来依赖具体的 UI 组件。
 *
 * 实现 design.md "Error Handling / 错误场景 4: 磁盘写入失败" 与 requirements.md
 * Requirement 6.4（持久化失败时的用户反馈）。
 *
 * 设计要点：
 *   - 模块级单例：模块加载时建立 listener registry，整个应用共享同一个实例
 *   - 类型化事件 map：emit 与 on 的 payload 类型由 EventMap 推导，调用方不可
 *     传入未声明的事件名或错误的 payload 形状
 *   - on() 返回取消订阅函数，便于 React 组件在 useEffect cleanup 中调用
 *   - emit 时即使某个 handler 抛错，也不影响其他 handler；错误吞掉但写入 console.error
 *   - 在没有任何监听者时（典型为单元测试场景）emit 是无副作用的 no-op
 *
 * 事件清单：
 *   - `storage:error`  { message }  — 持久化失败（磁盘满 / 权限拒绝等）
 *   - `storage:cleared`             — 数据已清空（预留，目前未在 store 内 emit）
 */

// ---------------------------------------------------------------------------
// 事件类型 map
// ---------------------------------------------------------------------------

/**
 * 所有合法事件的 name → payload 映射。
 *
 * `void` 表示该事件没有 payload（emit 时第二参数省略）。
 */
export interface EventMap {
  'storage:error': { message: string };
  'storage:cleared': void;
}

export type EventName = keyof EventMap;

/** 监听者回调签名；payload 由事件名推导 */
export type EventHandler<K extends EventName> = (payload: EventMap[K]) => void;

// ---------------------------------------------------------------------------
// EventBus 接口与工厂
// ---------------------------------------------------------------------------

export interface EventBus {
  /**
   * 触发一个事件。
   *
   * 当事件 payload 为 `void` 时，第二参数应省略；否则必须提供。
   */
  emit<K extends EventName>(
    type: K,
    ...args: EventMap[K] extends void ? [] : [payload: EventMap[K]]
  ): void;

  /**
   * 订阅一个事件，返回取消订阅函数。
   *
   * 同一个 handler 重复 on 会被去重（Set 语义）。
   */
  on<K extends EventName>(type: K, handler: EventHandler<K>): () => void;
}

/**
 * 创建一个独立的事件总线实例。
 *
 * 默认 export 的 `eventBus` 已经是一个全局 singleton；这里仅在需要隔离
 * 测试副作用时（例如属性测试）才用工厂创建独立实例。
 */
export function createEventBus(): EventBus {
  // 用 name → Set<handler> 索引；Set 保证重复订阅去重
  // unknown 在 emit 处再用 EventMap 收紧
  const listeners = new Map<EventName, Set<(payload: unknown) => void>>();

  function emit<K extends EventName>(
    type: K,
    ...args: EventMap[K] extends void ? [] : [payload: EventMap[K]]
  ): void {
    const set = listeners.get(type);
    if (!set || set.size === 0) return;
    const payload = (args.length > 0 ? args[0] : undefined) as EventMap[K];
    // 复制一份再迭代：防止 handler 在执行中修改原 set 造成迭代异常
    for (const handler of [...set]) {
      try {
        handler(payload as unknown);
      } catch (err) {
        // handler 内的异常不应影响其他订阅者或调用方
        // eslint-disable-next-line no-console
        console.error(`[eventBus] handler for "${type}" threw:`, err);
      }
    }
  }

  function on<K extends EventName>(type: K, handler: EventHandler<K>): () => void {
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(handler as (payload: unknown) => void);
    return () => {
      const current = listeners.get(type);
      if (!current) return;
      current.delete(handler as (payload: unknown) => void);
      if (current.size === 0) {
        listeners.delete(type);
      }
    };
  }

  return { emit, on };
}

// ---------------------------------------------------------------------------
// 全局 singleton
// ---------------------------------------------------------------------------

/** 应用范围内共享的事件总线（store / Toast 等模块都使用此实例） */
export const eventBus: EventBus = createEventBus();
