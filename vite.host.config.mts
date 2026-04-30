import { defineConfig } from "vite";
import { resolve } from "node:path";
import { builtinModules } from "node:module";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  build: {
    ssr: true,
    target: "node18",
    outDir: "out/host",
    rollupOptions: {
      input: { index: resolve(__dirname, "src/host/index.ts") },
      external: [/^@mariozechner\//, "electron", /^node:/, ...builtinModules],
      output: { format: "es", entryFileNames: "[name].mjs" },
    },
  },
});
