/**
 * StatsView 统计面板
 *
 * 显示追番统计数据：总集数、活跃天数、连续天数、每日观看图表。
 */

import { useMemo } from 'react';
import { useAnimeStore } from '../store/useAnimeStore';
import { getStats, getDailyWatchCounts } from '../lib/history';

import './StatsView.css';

export function StatsView(): JSX.Element {
  const animes = useAnimeStore((s) => s.animes);

  const stats = useMemo(() => getStats(animes.length), [animes.length]);
  const dailyCounts = useMemo(() => getDailyWatchCounts(30), []);
  const maxDaily = useMemo(() => Math.max(1, ...dailyCounts.map((d) => d.count)), [dailyCounts]);

  const watchingCount = animes.filter((a) => (a.watchStatus ?? 'watching') === 'watching').length;
  const completedCount = animes.filter((a) => a.watchStatus === 'completed').length;
  const planCount = animes.filter((a) => a.watchStatus === 'plan').length;
  const droppedCount = animes.filter((a) => a.watchStatus === 'dropped').length;

  return (
    <div className="stats-view">
      <header className="stats-view__header">
        <h1 className="stats-view__title">统计</h1>
      </header>

      <div className="stats-view__body">
        <div className="stats-view__inner">
          {/* 概览卡片 */}
          <div className="stats-view__grid">
            <div className="stats-view__stat-card">
              <span className="stats-view__stat-value">{stats.totalEpisodesWatched}</span>
              <span className="stats-view__stat-label">总观看集数</span>
            </div>
            <div className="stats-view__stat-card">
              <span className="stats-view__stat-value">{stats.streak}</span>
              <span className="stats-view__stat-label">连续观看天数</span>
            </div>
            <div className="stats-view__stat-card">
              <span className="stats-view__stat-value">{stats.averagePerDay.toFixed(1)}</span>
              <span className="stats-view__stat-label">日均集数</span>
            </div>
            <div className="stats-view__stat-card">
              <span className="stats-view__stat-value">{stats.totalDaysActive}</span>
              <span className="stats-view__stat-label">活跃天数</span>
            </div>
          </div>

          {/* 番剧状态分布 */}
          <section className="stats-view__section">
            <h2 className="stats-view__section-title">番剧状态</h2>
            <div className="stats-view__status-row">
              <div className="stats-view__status-item">
                <span className="stats-view__status-count">{watchingCount}</span>
                <span className="stats-view__status-label">在看</span>
              </div>
              <div className="stats-view__status-item">
                <span className="stats-view__status-count">{completedCount}</span>
                <span className="stats-view__status-label">看完</span>
              </div>
              <div className="stats-view__status-item">
                <span className="stats-view__status-count">{planCount}</span>
                <span className="stats-view__status-label">想看</span>
              </div>
              <div className="stats-view__status-item">
                <span className="stats-view__status-count">{droppedCount}</span>
                <span className="stats-view__status-label">弃番</span>
              </div>
            </div>
          </section>

          {/* 最近 30 天观看图表 */}
          <section className="stats-view__section">
            <h2 className="stats-view__section-title">最近 30 天</h2>
            <div className="stats-view__chart">
              {dailyCounts.map((d) => (
                <div key={d.date} className="stats-view__bar-col" title={`${d.date}: ${d.count} 集`}>
                  <div
                    className="stats-view__bar"
                    style={{ height: `${(d.count / maxDaily) * 100}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="stats-view__chart-labels">
              <span>{dailyCounts[0]?.date.slice(5)}</span>
              <span>今天</span>
            </div>
          </section>

          {/* 最活跃的一天 */}
          {stats.mostActiveDay && (
            <section className="stats-view__section">
              <h2 className="stats-view__section-title">最活跃的一天</h2>
              <p className="stats-view__highlight">
                {stats.mostActiveDay.date} — 看了 {stats.mostActiveDay.count} 集
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default StatsView;
