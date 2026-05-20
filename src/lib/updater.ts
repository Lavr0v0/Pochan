/**
 * 自动更新检查
 *
 * 使用 Tauri updater 插件检查 GitHub Releases 上的新版本。
 */

export async function checkForUpdate(): Promise<{ available: boolean; version?: string }> {
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (update) {
      return { available: true, version: update.version };
    }
    return { available: false };
  } catch {
    return { available: false };
  }
}

export async function installUpdate(): Promise<void> {
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (update) {
      await update.downloadAndInstall();
      // 重启应用
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    }
  } catch (e) {
    throw new Error(`更新失败：${e instanceof Error ? e.message : String(e)}`);
  }
}
