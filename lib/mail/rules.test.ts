import { describe, expect, it } from "vitest";

import { replyUpdate } from "./rules";

describe("replyUpdate", () => {
  it("moves an applied role on a clear rejection, interview or offer", () => {
    expect(replyUpdate("applied", "rejected", true)).toBe("rejected");
    expect(replyUpdate("applied", "interview", true)).toBe("interviewing");
    expect(replyUpdate("no_response", "assessment", true)).toBe("interviewing");
    expect(replyUpdate("interviewing", "offer", true)).toBe("offer");
    expect(replyUpdate("offer", "rejected", true)).toBe("rejected");
  });

  it("only moves a role forward", () => {
    expect(replyUpdate("offer", "interview", true)).toBeNull();
    expect(replyUpdate("interviewing", "interview", true)).toBeNull();
    expect(replyUpdate("rejected", "offer", true)).toBeNull();
  });

  it("changes nothing for a confirmation or a question", () => {
    expect(replyUpdate("applied", "received", true)).toBeNull();
    expect(replyUpdate("interviewing", "other", true)).toBeNull();
  });

  it("brings a role back from No response when the company writes", () => {
    expect(replyUpdate("no_response", "received", true)).toBe("applied");
    expect(replyUpdate("no_response", "other", true)).toBe("applied");
  });

  it("leaves the status alone when unsure", () => {
    expect(replyUpdate("applied", "rejected", false)).toBeNull();
    expect(replyUpdate("no_response", "other", false)).toBeNull();
  });
});
