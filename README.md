# Pochan 🫧

<p align="center">
  <img src="logo.png" width="128" alt="Pochan logo" />
</p>

A local-first anime tracker with bubble visualization. Your watching habits come alive as floating bubbles — the more you watch, the higher they float.

一个本地优先的追番工具。你的追番习惯以气泡的形式可视化——看得越多，气泡浮得越高。

## Features

- **Bubble View** — Each anime is a floating bubble. Position reflects your watching frequency
- **Library Panel** — Card grid with status filtering (watching / plan / completed / dropped)
- **Calendar** — Weekly airing schedule for your currently watching shows
- **Bangumi Integration** — Search and add anime from [Bangumi](https://bgm.tv), import your collection
- **Local Storage** — All data stored locally, no account needed
- **Cross-platform** — Windows, macOS, Linux (via Tauri)

## Screenshots

<!-- TODO: Add screenshots -->

## Tech Stack

- **Tauri 2.x** — Lightweight desktop framework (Rust backend + Web frontend)
- **React 18 + TypeScript + Vite** — Frontend
- **Zustand** — State management
- **Matter.js** — Physics engine for bubble animation
- **Bangumi API** — Anime metadata

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) 1.77+
- Platform-specific dependencies for [Tauri](https://v2.tauri.app/start/prerequisites/)

### Setup

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

## License

MIT
