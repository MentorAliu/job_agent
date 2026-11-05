import { describe, expect, it } from "vitest";

import { minimalThinking } from "./thinking";

describe("minimalThinking", () => {
  it("turns thinking off on Sonnet 5.5 with between_tools", () => {
    expect(minimalThinking("claude-sonnet-5-5")).toEqual({
      thinking: { type: "between_tools" },
    });
  });

  it("disables thinking on models that accept it", () => {
    expect(minimalThinking("claude-haiku-5-5")).toEqual({
      thinking: { type: "disabled" },
    });
  });

  it("leaves thinking out where it can't be turned off", () => {
    expect(minimalThinking("claude-opus-5-5")).toEqual({});
    expect(minimalThinking("claude-fable-5-1")).toEqual({});
  });
});
