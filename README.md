# Pochan

<p align="center">
  <img src="logo.png" width="128" alt="Pochan logo" />
</p>

<p align="center">
  <a href="#中文">中文</a> | <a href="#english">English</a>
</p>

---

## 中文

一个本地优先的追番工具。你的追番习惯以气泡的形式可视化——看得越多，气泡浮得越高。

### 功能

- **气泡视图** — 每部番剧是一个浮动气泡，位置反映你的观看频率
- **收藏库** — 卡片网格，支持状态筛选（在看 / 想看 / 看过 / 抛弃）
- **日历** — 当前在追番剧的每周放送时间表
- **Bangumi 集成** — 从 [Bangumi](https://bgm.tv) 搜索添加番剧，导入你的收藏
- **本地存储** — 所有数据存储在本地，无需账号
- **跨平台** — Windows、macOS、Linux（基于 Tauri）

### 技术栈

- **Tauri 2.x** — 轻量桌面框架（Rust 后端 + Web 前端）
- **React 18 + TypeScript + Vite** — 前端
- **Zustand** — 状态管理
- **Matter.js** — 气泡物理动画引擎
- **Bangumi API** — 番剧元数据

### 开发

#### 前置要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) 1.77+
- Tauri 平台依赖：[参考文档](https://v2.tauri.app/start/prerequisites/)

#### 启动

```bash
npm install
npm run tauri dev
```

#### 构建

```bash
npm run tauri build
```

### 许可证

MIT

---

## English

A local-first anime tracker with bubble visualization. Your watching habits come alive as floating bubbles — the more you watch, the higher they float.

### Features

- **Bubble View** — Each anime is a floating bubble. Position reflects your watching frequency
- **Library Panel** — Card grid with status filtering (watching / plan / completed / dropped)
- **Calendar** — Weekly airing schedule for your currently watching shows
- **Bangumi Integration** — Search and add anime from [Bangumi](https://bgm.tv), import your collection
- **Local Storage** — All data stored locally, no account needed
- **Cross-platform** — Windows, macOS, Linux (via Tauri)

### Tech Stack

- **Tauri 2.x** — Lightweight desktop framework (Rust backend + Web frontend)
- **React 18 + TypeScript + Vite** — Frontend
- **Zustand** — State management
- **Matter.js** — Physics engine for bubble animation
- **Bangumi API** — Anime metadata

### Development

#### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) 1.77+
- Platform-specific dependencies for [Tauri](https://v2.tauri.app/start/prerequisites/)

#### Setup

```bash
npm install
npm run tauri dev
```

#### Build

```bash
npm run tauri build
```

### License

MIT
