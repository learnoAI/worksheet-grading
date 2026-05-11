import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";


/** @type {import('eslint').Linter.Config[]} */
export default [
  {files: ["**/*.{js,mjs,cjs,ts}"]},
  {languageOptions: { globals: globals.browser }},
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Honor the `_` prefix convention as a signal that an argument or
    // variable is intentionally unused. The codebase already uses this
    // shape in many places (e.g. `vi.fn(async (..._args: Parameters<typeof fetch>) => ...)`
    // where the rest param is required for typing but never read in the
    // body). Without this override the recommended config flags every
    // such site as `no-unused-vars`.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
];
