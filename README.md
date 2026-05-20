# Pochan

<p align="center">
  <img src="logo.png" width="128" alt="Pochan logo" />
</p>

<p align="center">
  <a href="#中文">中文</a> | <a href="#english">English</a>
</p>

---

## 中文

一个本地优先的追番气泡工具。你的追番习惯以气泡的形式可视化——看得越多，气泡浮得越高。

### 界面导航

应用左侧面板提供三个标签页切换：

| 标签 | 说明 |
|------|------|
| **番剧库** | 管理所有追番，支持表格/卡片视图切换 |
| **日历** | 按月查看每周放送时间表 |
| **设置** | 数据导入/导出/清空 |

右侧始终显示**气泡画布**——你的追番以浮动气泡呈现。

### 气泡视图

- **左键点击气泡** → 已看集数 +1
- **右键点击气泡** → 已看集数 -1
- 看完最后一集时气泡会播放完成动画，窗口会抖一下
- 气泡大小和位置反映你的观看频率

右下角 **「+」按钮** → 打开添加番剧对话框，从 Bangumi 搜索并添加。

### 番剧库

- **布局切换**：表格 / 卡片
- **排序**：上次观看 / 名字 / 完成度 / 添加时间（升序/降序）
- **筛选**：全部 / 在看 / 想看 / 看完 / 弃番
- **搜索**：输入关键词快速定位
- **批量操作**：勾选多部番剧后可批量改状态或删除
- **查看详情**：双击表格行 / 点击卡片 → 打开详情弹窗

### 日历

- **← / →** 切换月份，**「今天」** 按钮跳回当月
- 每个日期格子显示当天放送的番剧缩略图
- **点击缩略图** → 查看番剧详情
- **点击空白格子** → 弹出「快速记录」，勾选今天看了的番，一键 +1

### 设置

| 功能 | 说明 |
|------|------|
| **导出 JSON** | 备份追番数据到本地文件 |
| **从 Bangumi 导入** | 输入用户名，一键导入公开收藏（追加，不覆盖） |
| **导入 JSON** | 从备份文件恢复（会替换当前数据） |
| **清空全部数据** | 删除所有记录（不可撤销） |

### 快捷键 & 操作

| 操作 | 效果 |
|------|------|
| 左键点击气泡 | 已看 +1 |
| 右键点击气泡 | 已看 -1 |
| 双击番剧库行 | 打开详情 |
| ESC | 关闭弹窗/对话框 |

### 安装

前往 [Releases](https://github.com/Lavr0v0/Pochan/releases) 下载对应平台的安装包：

| 平台 | 文件 |
|------|------|
| Windows x64 | `Pochan_x.x.x_x64-setup.exe` |
| Windows x86 | `Pochan_x.x.x_x86-setup.exe` |
| Windows ARM64 | `Pochan_x.x.x_arm64-setup.exe` |

> ⚠️ Windows 可能弹出 SmartScreen 警告，这是因为安装包未签名。点击「更多信息」→「仍要运行」即可正常安装。
| macOS (Apple Silicon) | `Pochan_x.x.x_aarch64.dmg` |
| macOS (Intel) | `Pochan_x.x.x_x64.dmg` |
| Linux x64 | `pochan_x.x.x_amd64.deb` / `.AppImage` |

### 数据存储

所有数据保存在本地，无需注册账号。数据文件位于系统应用数据目录中。

### 许可证

MIT

---

## English

A local-first anime tracker with bubble visualization. Your watching habits come alive as floating bubbles — the more you watch, the higher they float.

### Navigation

The left panel has three tabs:

| Tab | Description |
|-----|-------------|
| **Library** | Manage all tracked anime with table/card views |
| **Calendar** | Monthly view of weekly airing schedules |
| **Settings** | Import/export/clear data |

The right side always shows the **Bubble Canvas** — your anime as floating bubbles.

### Bubble View

- **Left-click a bubble** → Watched episodes +1
- **Right-click a bubble** → Watched episodes -1
- Finishing the last episode triggers a completion animation and window shake
- Bubble size and position reflect your watching frequency

**"+" button** (bottom-right) → Open the add anime dialog, search from Bangumi.

### Library

- **Layout**: Table / Card toggle
- **Sort**: Last watched / Name / Progress / Date added (asc/desc)
- **Filter**: All / Watching / Plan / Completed / Dropped
- **Search**: Quick keyword search
- **Bulk actions**: Select multiple anime to batch change status or delete
- **Details**: Double-click a row / click a card → Open detail modal

### Calendar

- **← / →** to navigate months, **"Today"** button to jump back
- Each date cell shows airing anime thumbnails for that day
- **Click thumbnail** → View anime details
- **Click empty cell** → Quick log dialog, check what you watched today, +1 each

### Settings

| Feature | Description |
|---------|-------------|
| **Export JSON** | Back up your data to a local file |
| **Import from Bangumi** | Enter username to import public collection (appends, no overwrite) |
| **Import JSON** | Restore from backup (replaces current data) |
| **Clear all data** | Delete everything (irreversible) |

### Controls

| Action | Effect |
|--------|--------|
| Left-click bubble | Watched +1 |
| Right-click bubble | Watched -1 |
| Double-click library row | Open details |
| ESC | Close dialogs |

### Installation

Go to [Releases](https://github.com/Lavr0v0/Pochan/releases) and download the installer for your platform:

| Platform | File |
|----------|------|
| Windows x64 | `Pochan_x.x.x_x64-setup.exe` |
| Windows x86 | `Pochan_x.x.x_x86-setup.exe` |
| Windows ARM64 | `Pochan_x.x.x_arm64-setup.exe` |
| macOS (Apple Silicon) | `Pochan_x.x.x_aarch64.dmg` |
| macOS (Intel) | `Pochan_x.x.x_x64.dmg` |
| Linux x64 | `pochan_x.x.x_amd64.deb` / `.AppImage` |

> ⚠️ Windows may show a SmartScreen warning because the installer is unsigned. Click "More info" → "Run anyway" to proceed.

### Data Storage

All data is stored locally. No account needed. Data files are in your system's app data directory.

### License

MIT
