import { vi } from "vitest";

// Steps read the Claude API key from the database first (a key pasted in
// setup or Settings), then ANTHROPIC_API_KEY. Tests have no database, so the
// key comes from the environment alone, as vitest.config.mts sets it. A test
// that mocks lib/pipeline/engine-state itself says where the key comes from.
vi.mock("@/lib/pipeline/engine-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pipeline/engine-state")>()),
  readSavedClaudeApiKey: async () => null,
  readClaudeApiKey: async () => process.env.ANTHROPIC_API_KEY?.trim() || null,
}));
