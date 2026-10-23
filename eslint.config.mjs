import globals from "globals";
import style from "./quality/style.config.mjs";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...style,
  {
    files: ["src/**/*.ts", "demos/**/*.ts"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["*.{js,mjs,ts}", "quality/**/*.mjs", "tests/**/*.ts"],
    languageOptions: { globals: globals.nodeBuiltin },
  },
];
