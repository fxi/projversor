import globals from "globals";
import style from "./quality/style.config.mjs";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...style,
  {
    files: ["src/**/*.ts"],
    languageOptions: { globals: globals.browser },
    rules: {
      // The engine owns no integration: zartigl, MapLibre and MapX depend on
      // projversor, never the reverse.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@fxi/zartigl", "@fxi/zartigl/*", "maplibre-gl", "d3"],
              message:
                "projversor imports no integration; use d3-geo or d3-ease modules.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["*.{js,mjs,cjs,ts}", "quality/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: { globals: globals.nodeBuiltin },
  },
];
