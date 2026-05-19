# GitHub Repository 配置参考

设置 GitHub 仓库时可参考以下信息。

---

## 基本信息

| 字段 | 内容 |
|------|------|
| **Name** | Pochan |
| **Description** | 本地优先的追番气泡工具 / A local-first anime tracker with bubble visualization |
| **Website** | *(留空或填你的主页)* |
| **Topics** | `anime`, `tracker`, `tauri`, `react`, `bangumi`, `desktop-app`, `bubble`, `typescript` |
| **License** | MIT |

---

## About 描述（短）

> A local-first anime tracker with bubble visualization. Built with Tauri + React.

---

## Release 说明模板

```
## Pochan vX.X.X

### 下载

| 平台 | 架构 | 文件 |
|------|------|------|
| Windows | x64 | Pochan_X.X.X_x64-setup.exe |
| Windows | x64 | Pochan_X.X.X_x64_en-US.msi |
| Windows | x86 | Pochan_X.X.X_x86-setup.exe |
| Windows | ARM64 | Pochan_X.X.X_arm64-setup.exe |
| macOS | Apple Silicon | Pochan_X.X.X_aarch64.dmg |
| macOS | Intel | Pochan_X.X.X_x64.dmg |
| Linux | x64 | pochan_X.X.X_amd64.deb / .AppImage |

### 更新内容

- ...
```

---

## CI/CD

已配置 GitHub Actions（`.github/workflows/build.yml`），支持：

- **触发方式**：推送 `v*` 标签（如 `v0.1.0`）或手动触发
- **构建平台**：
  - Windows x64 / x86 / ARM64
  - macOS Apple Silicon / Intel
  - Linux x64
- **产物**：自动创建 GitHub Release Draft，附带所有平台安装包

### 使用方法

```bash
# 打标签触发构建
git tag v0.1.0
git push origin v0.1.0
```

构建完成后去 GitHub Releases 页面编辑并发布即可。

---

## 仓库设置建议

- [x] Issues 开启
- [x] Discussions 可选开启
- [ ] Wiki 不需要（README 够用）
- [x] Actions 权限：允许 read/write（用于自动创建 Release）
