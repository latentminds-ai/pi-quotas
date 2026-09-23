import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Linting configuration for @terrydada-art/pi-quotas.
//
// This config codifies the existing repo style as the enforced default so that
// contributions are checked consistently before merge:
//   - 2-space indentation, no tabs
//   - double quotes
//   - semicolons required
//   - trailing commas in multiline constructs
//
// It mirrors the conventions already present across `src/` (TypeScript, ESM,
// strict mode) and is intentionally non-type-checked to keep `npm run lint`
// fast and decoupled from the TypeScript program.
export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "dist/",
      "coverage/",
      "*.tgz",
      ".security-scan/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Style — matches existing repo structure (the enforced default).
      indent: ["error", 2, { SwitchCase: 1 }],
      "no-tabs": "error",
      quotes: ["error", "double", { avoidEscape: true, allowTemplateLiterals: true }],
      semi: ["error", "always"],
      "comma-dangle": ["error", "always-multiline"],
      "no-trailing-spaces": "error",
      "eol-last": ["error", "always"],
      "no-multiple-empty-lines": ["error", { max: 1, maxEOF: 1, maxBOF: 0 }],

      // Code quality.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "prefer-const": "error",
      "no-var": "error",
      // The repo uses `== null` / `!= null` as the idiomatic null|undefined check;
      // enforcing `=== null` would silently drop the undefined case.
      eqeqeq: ["error", "always", { null: "ignore" }],
      // Provider parsers intentionally accept untyped JSON (`any`); see parse*.ts.
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
