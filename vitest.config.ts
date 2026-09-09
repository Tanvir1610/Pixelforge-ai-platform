import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
      // `server-only` is a Next.js build-time guard with no runtime module.
      // Stubbing it lets server modules be unit-tested while the guard still
      // does its job in the real build.
      "server-only": resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
