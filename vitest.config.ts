import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "server-only": path.resolve(import.meta.dirname, "tests/empty.ts") } },
  test: { include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"], fileParallelism: false, setupFiles: ["tests/setup.ts"], testTimeout: 20000 },
});
