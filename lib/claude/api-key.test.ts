import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeAnthropic } from "@/test/fake-anthropic";

import {
  checkClaudeApiKey,
  hasClaudeApiKey,
  NoApiKeyError,
  withClaudeApiKey,
} from "./api-key";

// test/setup.ts reads the key from ANTHROPIC_API_KEY, the way the app does
// when no key was pasted in setup or Settings.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("withClaudeApiKey", () => {
  it("gives the client the owner's key, once per key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-pasted-0000000000000000000000");
    const { client } = fakeAnthropic([]);
    const keyed = await withClaudeApiKey(client);
    expect(keyed).not.toBe(client);
    expect(keyed.apiKey).toBe("sk-ant-pasted-0000000000000000000000");
    expect(await withClaudeApiKey(client)).toBe(keyed);
  });

  it("follows a key changed since the last call", async () => {
    const { client } = fakeAnthropic([]);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-first-00000000000000000000000");
    const first = await withClaudeApiKey(client);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-second-0000000000000000000000");
    const second = await withClaudeApiKey(client);
    expect(second).not.toBe(first);
    expect(second.apiKey).toBe("sk-ant-second-0000000000000000000000");
  });

  it("keeps the client as it is when it already has the key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const { client } = fakeAnthropic([]);
    expect(await withClaudeApiKey(client)).toBe(client);
  });

  it("keeps the client's own fetch, so tests and the smoke fake still answer", async () => {
    const { client, requests } = fakeAnthropic([
      { requestId: "req_models", body: { data: [], has_more: false } },
    ]);
    const keyed = await withClaudeApiKey(client);
    await keyed.models.list();
    expect(requests).toHaveLength(1);
  });

  it("throws NoApiKeyError when there's no key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", " ");
    const { client } = fakeAnthropic([]);
    await expect(withClaudeApiKey(client)).rejects.toBeInstanceOf(
      NoApiKeyError,
    );
    await expect(withClaudeApiKey(client, "codex")).rejects.toThrow(
      /Codex couldn't run this step/,
    );
    expect(await hasClaudeApiKey()).toBe(false);
  });
});

describe("checkClaudeApiKey", () => {
  /** A fetch that answers the model list with `status`. */
  function answering(status: number) {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify(
            status === 200
              ? { data: [], has_more: false, first_id: null, last_id: null }
              : {
                  type: "error",
                  error: { type: "authentication_error", message: "no" },
                },
          ),
          { status, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("accepts a key the model list takes", async () => {
    const fetch = answering(200);
    expect(await checkClaudeApiKey("sk-ant-good-000000000000000000000")).toBe(
      "ok",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/v1/models");
  });

  it("refuses a key only when the API says it's wrong", async () => {
    answering(401);
    expect(await checkClaudeApiKey("sk-ant-wrong-00000000000000000000")).toBe(
      "refused",
    );
  });

  it("can't tell when the API is down or out of reach", async () => {
    answering(500);
    expect(await checkClaudeApiKey("sk-ant-maybe-00000000000000000000")).toBe(
      "unknown",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(await checkClaudeApiKey("sk-ant-maybe-00000000000000000000")).toBe(
      "unknown",
    );
  });
});
