/**
 * Sidebar 侧边栏导航
 *
 * 实现 design.md "Components and Interfaces / Sidebar" 与 requirements.md
 * Requirement 9（侧边栏导航）。
 *
 * 职责：
 *   1. 渲染四个导航入口：气泡视图 / 日历视图 / 番剧库视图 / 设置页
 *   2. 接收 currentView 与 onViewChange props
 *   3. 高亮当前视图（aria-current="page" + active 修饰符 class）
 *   4. 通过 button 元素保证键盘可达性（Tab / Enter / Space）
 *
 * 注意：
 *   - ViewKey 类型从 ../views/BubbleView 复用，避免重复定义
 *   - MVP 使用 emoji 作为图标（🫧 / 📅 / 📚 / ⚙️），后续可替换为 SVG
 *   - 宽度 176px、背景 --color-bg-soft，与工具栏保持一致的「次级面板」语义
 *
 * Validates: Requirements 9.1, 9.2, 9.3
 */

import type { ViewKey } from '../views/BubbleView';

import './Sidebar.css';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface SidebarProps {
  currentView: ViewKey;
  onViewChange: (view: ViewKey) => void;
}

interface NavItem {
  key: ViewKey;
  label: string;
  icon: string;
}

// ---------------------------------------------------------------------------
// 静态导航项配置
//
// 顺序与 Requirement 9.1 一致：气泡视图 → 日历视图 → 番剧库视图 → 设置页
// ---------------------------------------------------------------------------

const NAV_ITEMS: readonly NavItem[] = [
  { key: 'bubble', label: '气泡', icon: '🫧' },
  { key: 'calendar', label: '日历', icon: '📅' },
  { key: 'library', label: '番剧库', icon: '📚' },
  { key: 'settings', label: '设置', icon: '⚙️' },
] as const;

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function Sidebar(props: SidebarProps): JSX.Element {
  const { currentView, onViewChange } = props;

  return (
    <nav className="sidebar" aria-label="主导航">
      <ul className="sidebar__list">
        {NAV_ITEMS.map((item) => {
          const active = item.key === currentView;
          return (
            <li key={item.key} className="sidebar__item">
              <button
                type="button"
                className={
                  'sidebar__link' +
                  (active ? ' sidebar__link--active' : '')
                }
                aria-current={active ? 'page' : undefined}
                onClick={() => onViewChange(item.key)}
              >
                <span className="sidebar__icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="sidebar__label">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default Sidebar;
