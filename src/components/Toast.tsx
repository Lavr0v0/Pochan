/**
 * Toast 全局错误提示
 *
 * 实现 design.md "Error Handling / 错误场景 4: 磁盘写入失败" 与 requirements.md
 * Requirement 6.4（持久化失败时弹 toast「保存失败，请检查磁盘空间」）。
 *
 * 职责：
 *   1. 在 mount 时订阅 eventBus 的 'storage:error' 事件
 *   2. 收到事件后将 message 加入队列，固定停留 5 秒后自动消失
 *   3. 用户也可点击关闭按钮 × 立即移除某条 toast
 *   4. 多条 toast 堆叠在视口右下角（最新的在最下方），不会互相覆盖
 *   5. unmount 时清理订阅与所有计时器，避免内存泄漏
 *
 * 注意：
 *   - 仅消费事件、不直接耦合 store；这样 store 可以单独测试
 *   - 用 useRef 维护 ID 自增，避免在 React 18 严格模式下重复挂载导致 ID 冲突
 *   - 渲染容器使用 fixed 定位 + pointer-events: none，单条 toast 自身重新启用
 *     pointer-events，避免覆盖底层视图的点击区域
 */

import { useEffect, useRef, useState, useCallback } from 'react';

import { eventBus } from '../lib/eventBus';

import './Toast.css';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 单条 toast 默认停留时长（毫秒）—— 5 秒，与 design.md 错误处理表述一致 */
const TOAST_DURATION_MS = 5000;

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface ToastEntry {
  id: number;
  message: string;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 顶层 Toast 容器。
 *
 * 一般在 `App.tsx` 中放置一次即可，本组件负责自身的生命周期管理。
 */
export function Toast(): JSX.Element {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  // 自增 ID（每条 toast 都需要稳定的 React key）
  const nextIdRef = useRef<number>(1);
  // 每条 toast 对应的 setTimeout 句柄，用于 unmount / 手动关闭时清理
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  /** 移除一条 toast，同时清理它的计时器 */
  const dismiss = useCallback((id: number) => {
    const timers = timersRef.current;
    const timer = timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // —— 订阅 eventBus 'storage:error' ——
  useEffect(() => {
    const unsubscribe = eventBus.on('storage:error', (payload) => {
      const id = nextIdRef.current++;
      setToasts((prev) => [...prev, { id, message: payload.message }]);

      const timer = setTimeout(() => {
        timersRef.current.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, TOAST_DURATION_MS);
      timersRef.current.set(id, timer);
    });

    return () => {
      unsubscribe();
      // unmount 时清理所有未触发的计时器
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
      timersRef.current.clear();
    };
  }, []);

  return (
    <div className="toast-container" role="region" aria-label="通知" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast toast--error" role="alert">
          <span className="toast__message">{t.message}</span>
          <button
            type="button"
            className="toast__close"
            aria-label="关闭通知"
            onClick={() => dismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export default Toast;
