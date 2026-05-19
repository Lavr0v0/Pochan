import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest 配置：与 Vite 共享 React 插件，启用 jsdom 环境与 jest-dom 匹配器
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
