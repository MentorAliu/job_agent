import type { ApplyKit } from "@/lib/dal/apply-kit";
import type { AnswerView } from "@/lib/documents/view";

// The apply kit's answers: the ones ready to paste, and the ones only the
// owner can give.

/** Answers ready to paste, and the ones the owner has to give themselves. */
export function answerProgress(answers: { items: AnswerView[] } | null): {
  ready: AnswerView[];
  forYou: AnswerView[];
} {
  const items = answers?.items ?? [];
  return {
    ready: items.filter((item) => item.answer && !item.flag),
    forYou: items.filter((item) => !item.answer || item.flag),
  };
}

/** Every answer that's ready, as "question, answer" pairs for one paste. */
export function answersText(answers: ApplyKit["answers"]): string {
  return answerProgress(answers)
    .ready.map((item) => `${item.question}\n${item.answer}`)
    .join("\n\n");
}
