// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  // Base JS + TS recommended rules
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // React hooks rules for renderer files
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Essential hooks rules only — v7 added aggressive React Compiler rules
      // that flag valid patterns (setState in effects, Date.now() in render, etc.)
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Project-wide rule overrides
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // TypeScript handles undefined variable checking
      "no-undef": "off",
    },
  },

  // Ignore built output and config files
  {
    ignores: [
      "out/**",
      "dist/**",
      "node_modules/**",
      "eslint.config.mjs",
      "*.config.ts",
      "*.config.mts",
      "*.config.js",
    ],
  },
);
