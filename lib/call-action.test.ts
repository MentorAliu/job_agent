import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { describe, expect, it, vi } from "vitest";

import { formError } from "@/lib/schemas/action";

import {
  ACTION_FAILED_MESSAGE,
  callAction,
  STALE_PAGE_MESSAGE,
} from "./call-action";

describe("callAction", () => {
  it("returns the action's result", async () => {
    await expect(callAction(async () => ({ ok: true }))).resolves.toEqual({
      ok: true,
    });
  });

  it("asks for a reload when the server doesn't know the action", async () => {
    const result = await callAction(async () => {
      throw new UnrecognizedActionError('Server Action "abc" was not found');
    });
    expect(result).toEqual(formError(STALE_PAGE_MESSAGE));
  });

  it("turns any other failure into a form error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await callAction(async () => {
      throw new Error("Failed to fetch");
    });
    expect(result).toEqual(formError(ACTION_FAILED_MESSAGE));
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
