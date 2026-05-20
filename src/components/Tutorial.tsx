/**
 * Tutorial 新手引导组件
 *
 * 首次打开应用时自动显示，通过一系列步骤引导用户了解各功能区域。
 * 可在设置中重新触发。
 *
 * 实现方式：
 *   - 全屏 overlay + 高亮区域（通过 CSS box-shadow 实现聚光灯效果）
 *   - 每步包含标题、描述文字和步骤指示器
 *   - 支持「上一步」「下一步」「跳过」操作
 *   - 完成后在 localStorage 中标记，不再自动弹出
 */

import { useCallback, useEffect, useState } from 'react';
import './Tutorial.css';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'pochan-tutorial-completed';

export interface TutorialStep {
  /** 步骤标题 */
  title: string;
  /** 步骤描述 */
  description: string;
  /** 高亮目标的 CSS 选择器（可选，无则居中显示） */
  target?: string;
  /** 提示框相对于高亮区域的位置 */
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: '欢迎使用 Pochan！',
    description: '这是一个追番记录工具。接下来带你快速了解各个功能区域。',
    position: 'center',
  },
  {
    title: '气泡画布',
    description: '右侧是气泡画布，每个气泡代表一部正在看的番剧。\n\n· 单击气泡 = 记录看了一集\n· 右键点击 = 撤回一集\n· 气泡越大 = 看得越多\n· 气泡越高 = 看得越频繁',
    target: '.app__canvas',
    position: 'left',
  },
  {
    title: '添加番剧',
    description: '点击左侧面板右下角的「＋」按钮，可以搜索并添加新番剧到追踪列表。',
    target: '.app__panel-fab',
    position: 'top',
  },
  {
    title: '番剧库',
    description: '左侧面板的「番剧库」标签页可以查看所有番剧的列表视图，支持搜索、筛选和批量操作。\n\n双击某部番剧可以打开详情面板，编辑笔记、调整集数或更改颜色。',
    target: '.app__panel',
    position: 'right',
  },
  {
    title: '日历视图',
    description: '「日历」标签页展示每周更新的番剧封面，点击日期格子可以查看当天的观看记录。',
    target: '.app__panel-tabs',
    position: 'bottom',
  },
  {
    title: '设置',
    description: '在「设置」中可以切换主题、导入导出数据、从 Bangumi 同步收藏。\n\n如果想重新看这个引导，也可以在设置中找到「重新引导」按钮。',
    target: '.app__panel-tabs',
    position: 'bottom',
  },
  {
    title: '开始使用吧！',
    description: '现在你已经了解了 Pochan 的基本操作。\n\n试试添加一部番剧，然后点击气泡记录观看进度吧！',
    position: 'center',
  },
];

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 检查是否已完成过引导 */
export function isTutorialCompleted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** 标记引导已完成 */
export function markTutorialCompleted(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    // 静默
  }
}

/** 重置引导状态（设置中「重新引导」使用） */
export function resetTutorial(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 静默
  }
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

interface TutorialProps {
  /** 是否显示 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

export function Tutorial(props: TutorialProps): JSX.Element | null {
  const { open, onClose } = props;
  const [step, setStep] = useState(0);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);

  const currentStep = TUTORIAL_STEPS[step];
  const isFirst = step === 0;
  const isLast = step === TUTORIAL_STEPS.length - 1;

  // 计算高亮区域位置
  useEffect(() => {
    if (!open || !currentStep?.target) {
      setHighlightRect(null);
      return;
    }

    const updateRect = (): void => {
      const el = document.querySelector(currentStep.target!);
      if (el) {
        setHighlightRect(el.getBoundingClientRect());
      } else {
        setHighlightRect(null);
      }
    };

    updateRect();

    // 监听窗口变化
    window.addEventListener('resize', updateRect);
    return () => window.removeEventListener('resize', updateRect);
  }, [open, step, currentStep]);

  const handleNext = useCallback(() => {
    if (isLast) {
      markTutorialCompleted();
      onClose();
    } else {
      setStep((s) => s + 1);
    }
  }, [isLast, onClose]);

  const handlePrev = useCallback(() => {
    if (!isFirst) {
      setStep((s) => s - 1);
    }
  }, [isFirst]);

  const handleSkip = useCallback(() => {
    markTutorialCompleted();
    onClose();
  }, [onClose]);

  // 键盘支持
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') handleSkip();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') handleNext();
      else if (e.key === 'ArrowLeft') handlePrev();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, handleSkip, handleNext, handlePrev]);

  if (!open || !currentStep) return null;

  // 计算提示框位置
  const tooltipStyle = computeTooltipPosition(currentStep.position, highlightRect);

  return (
    <div className="tutorial-overlay" role="dialog" aria-modal="true" aria-label="新手引导">
      {/* 聚光灯遮罩 */}
      {highlightRect ? (
        <div
          className="tutorial-spotlight"
          style={{
            top: highlightRect.top - 8,
            left: highlightRect.left - 8,
            width: highlightRect.width + 16,
            height: highlightRect.height + 16,
          }}
        />
      ) : null}

      {/* 提示卡片 */}
      <div className="tutorial-tooltip" style={tooltipStyle}>
        <div className="tutorial-tooltip__header">
          <h3 className="tutorial-tooltip__title">{currentStep.title}</h3>
          <span className="tutorial-tooltip__step-indicator">
            {step + 1} / {TUTORIAL_STEPS.length}
          </span>
        </div>
        <p className="tutorial-tooltip__description">{currentStep.description}</p>
        <div className="tutorial-tooltip__actions">
          <button
            type="button"
            className="tutorial-tooltip__skip"
            onClick={handleSkip}
          >
            跳过
          </button>
          <div className="tutorial-tooltip__nav">
            {!isFirst && (
              <button
                type="button"
                className="tutorial-tooltip__prev"
                onClick={handlePrev}
              >
                上一步
              </button>
            )}
            <button
              type="button"
              className="tutorial-tooltip__next"
              onClick={handleNext}
            >
              {isLast ? '完成' : '下一步'}
            </button>
          </div>
        </div>
        {/* 步骤点指示器 */}
        <div className="tutorial-tooltip__dots">
          {TUTORIAL_STEPS.map((_, i) => (
            <span
              key={i}
              className={`tutorial-tooltip__dot${i === step ? ' tutorial-tooltip__dot--active' : ''}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** 根据 position 和高亮区域计算提示框的 CSS 定位，确保不超出视口 */
function computeTooltipPosition(
  position: string | undefined,
  rect: DOMRect | null,
): React.CSSProperties {
  if (!rect || position === 'center' || !position) {
    // 居中显示
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }

  const gap = 20;
  const margin = 16; // 距离视口边缘的最小间距

  switch (position) {
    case 'top': {
      const top = rect.top - gap;
      // 如果上方空间不够，改为下方
      if (top < 200) {
        return {
          top: `${rect.bottom + gap}px`,
          left: `${Math.max(margin, Math.min(rect.left + rect.width / 2, window.innerWidth - margin))}px`,
          transform: 'translateX(-50%)',
        };
      }
      return {
        bottom: `${window.innerHeight - rect.top + gap}px`,
        left: `${Math.max(margin, Math.min(rect.left + rect.width / 2, window.innerWidth - margin))}px`,
        transform: 'translateX(-50%)',
      };
    }
    case 'bottom':
      return {
        top: `${rect.bottom + gap}px`,
        left: `${Math.max(margin, Math.min(rect.left + rect.width / 2, window.innerWidth - margin))}px`,
        transform: 'translateX(-50%)',
      };
    case 'left': {
      // 如果左侧空间不够（< 400px），改为居中偏右
      if (rect.left < 400) {
        return {
          top: `${Math.max(margin, rect.top)}px`,
          left: `${rect.right + gap}px`,
          transform: 'none',
        };
      }
      return {
        top: `${Math.max(margin, rect.top + rect.height / 2)}px`,
        right: `${window.innerWidth - rect.left + gap}px`,
        transform: 'translateY(-50%)',
      };
    }
    case 'right': {
      // 如果右侧空间不够，改为左侧
      if (window.innerWidth - rect.right < 400) {
        return {
          top: `${Math.max(margin, rect.top + rect.height / 2)}px`,
          right: `${window.innerWidth - rect.left + gap}px`,
          transform: 'translateY(-50%)',
        };
      }
      return {
        top: `${Math.max(margin, rect.top + rect.height / 2)}px`,
        left: `${rect.right + gap}px`,
        transform: 'translateY(-50%)',
      };
    }
    default:
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
  }
}

export default Tutorial;
