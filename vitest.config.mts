import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(
        new URL("./test/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**"],
    setupFiles: ["./test/setup.ts"],
    env: {
      // Steps check the app has a Claude API key before calling the API.
      // Tests never call it (they use fakes and recorded responses), so a
      // fake does.
      ANTHROPIC_API_KEY: "sk-ant-test-not-a-real-key",
    },
  },
});
