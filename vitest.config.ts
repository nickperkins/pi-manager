import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";

const alias = { "@shared": resolve(__dirname, "src/shared") };

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/renderer/env.d.ts",
        "src/renderer/main.tsx",
        "src/preload/index.d.ts",
      ],
    },
    projects: [
      // ── Node environment: host + main unit tests ──────────────────────
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          include: [
            "tests/unit/host/**/*.test.ts",
            "tests/unit/main/**/*.test.ts",
          ],
        },
      },

      // ── jsdom environment: renderer unit tests ────────────────────────
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "renderer",
          environment: "jsdom",
          include: ["tests/unit/renderer/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/setup/renderer.ts"],
        },
      },
    ],
  },
});
