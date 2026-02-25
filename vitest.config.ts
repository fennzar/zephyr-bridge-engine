import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup/env.ts", "./tests/setup/console.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(rootDir, "src/shared"),
      "@shared/*": path.resolve(rootDir, "src/shared/*"),
      "@domain": path.resolve(rootDir, "src/domain"),
      "@domain/*": path.resolve(rootDir, "src/domain/*"),
      "@infra": path.resolve(rootDir, "src/infra"),
      "@infra/*": path.resolve(rootDir, "src/infra/*"),
      "@services": path.resolve(rootDir, "src/services"),
      "@services/*": path.resolve(rootDir, "src/services/*"),
      "next/server": path.resolve(rootDir, "tests/mocks/next-server.ts"),
    },
  },
});
