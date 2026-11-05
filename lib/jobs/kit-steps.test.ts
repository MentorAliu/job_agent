import { describe, expect, it } from "vitest";

import type { ApplyKit, KitDocument } from "@/lib/dal/apply-kit";
import type { AnswerView } from "@/lib/documents/view";

import { answerProgress, answersText } from "./kit-steps";

function kitDocument(kind: KitDocument["kind"], pdf: boolean): KitDocument {
  return {
    id: `doc-${kind}`,
    kind,
    version: 1,
    readyAt: "2026-10-18T10:00:00.000Z",
    note: null,
    edited: false,
    pdfUrl: pdf ? `/api/documents/doc-${kind}/pdf` : null,
    flags: [],
    checkedAt: "2026-10-18T10:01:00.000Z",
    checkError: null,
  };
}

function answer(id: string, overrides: Partial<AnswerView> = {}): AnswerView {
  return {
    id,
    question: `Question ${id}?`,
    answer: `Answer ${id}.`,
    missing: "",
    flag: null,
    fromStandard: false,
    ...overrides,
  };
}

const LEFT_OUT = {
  itemId: "a2",
  kind: "unsupported" as const,
  reason: "Not in the profile.",
  text: "Answer a2.",
};

const answers: NonNullable<ApplyKit["answers"]> = {
  document: kitDocument("answers", false),
  items: [
    answer("a0"),
    answer("a1", { answer: "", missing: "Your notice period." }),
    answer("a2", { flag: LEFT_OUT }),
  ],
};

describe("the kit's answers", () => {
  it("splits the answers into ready ones and the owner's", () => {
    const { ready, forYou } = answerProgress(answers);
    expect(ready.map((item) => item.id)).toEqual(["a0"]);
    // Unanswered, or left out because it didn't check out.
    expect(forYou.map((item) => item.id)).toEqual(["a1", "a2"]);
    expect(answerProgress(null)).toEqual({ ready: [], forYou: [] });
  });

  it("copies only the answers that are ready", () => {
    expect(answersText(answers)).toBe("Question a0?\nAnswer a0.");
  });
});
