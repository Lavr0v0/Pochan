/**
 * Tauri 窗口特效
 *
 * 把 Tauri window API 调用集中在这里，避免散落在组件逻辑中。
 */

export async function shakeWindow(): Promise<void> {
  try {
    const [{ getCurrentWindow }, { PhysicalPosition }] = await Promise.all([
      import('@tauri-apps/api/window'),
      import('@tauri-apps/api/dpi'),
    ]);

    const win = getCurrentWindow();
    const pos = await win.outerPosition();

    for (let i = 0; i < 6; i++) {
      const offset = i % 2 === 0 ? 4 : -4;
      await win.setPosition(new PhysicalPosition(pos.x + offset, pos.y));
      await new Promise((r) => setTimeout(r, 32));
    }

    await win.setPosition(new PhysicalPosition(pos.x, pos.y));
  } catch {
    // ignore outside Tauri or when window API fails
  }
}
