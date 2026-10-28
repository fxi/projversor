import globals from "globals";
import style from "./quality/style.config.mjs";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...style,
  {
    files: ["src/**/*.ts", "apps/**/*.ts"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      "*.{js,mjs,ts}",
      "apps/*/vite.config.ts",
      "quality/**/*.mjs",
      "tests/**/*.ts",
    ],
    languageOptions: { globals: globals.nodeBuiltin },
  },
];
