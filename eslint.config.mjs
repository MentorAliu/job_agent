import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import pluginQuery from "@tanstack/eslint-plugin-query";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Strict adds prefer-query-options: every query is a queryOptions factory.
  ...pluginQuery.configs["flat/recommended-strict"],
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated
    "components/ui/**",
    "hooks/use-mobile.ts",
    "db/migrations/**",
    // The smoke test's report and traces
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
