import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/engine/**/*.ts"],
      exclude: ["src/engine/vault.ts"], // Obsidian API 어댑터 (통합 테스트는 InMemoryVault 사용)
    },
  },
  resolve: {
    alias: {
      // 테스트에서 obsidian import 를 스텁으로 대체
      obsidian: new URL("./tests/helpers/obsidianStub.ts", import.meta.url).pathname,
    },
  },
});
