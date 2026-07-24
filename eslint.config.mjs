// ESLint v9 flat config — TypeScript 用の最小土台（M0-13）。
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "unity-bridge/**",
      "scripts/**",
      "test/**",
      "docs/archive/**",
      ".tmp/**",
      "artifacts/**",
      "CloudServer/hakkei-score-server/assets/js/jsQR.js",
      "**/*.mjs",
      "**/*.cjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
);
