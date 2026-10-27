import path from "node:path";

import { defineConfig } from "vitest/config";

// Tests run against their own database so they can truncate freely. Override
// with TEST_DATABASE_URL; the name must end in "_test" (checked in global setup).
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/task_management_test?schema=public";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    env: { DATABASE_URL: testDatabaseUrl, DIRECT_URL: testDatabaseUrl },
    // One shared database: run files one at a time.
    fileParallelism: false,
  },
});
