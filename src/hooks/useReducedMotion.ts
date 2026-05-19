import { useEffect, useState } from 'react';

/**
 * 检测用户是否开启了减少动画偏好。
 * BubbleCanvas 用它来关闭持续浮动动画。
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (event: MediaQueryListEvent) => {
      setReduced(event.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return reduced;
}
