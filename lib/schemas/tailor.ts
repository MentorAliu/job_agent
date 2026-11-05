// Tailoring (steps 7–10): what Claude writes for one role, how it's stored in
// `document.content`, the claim check's flags, and the tailoring progress kept
// on `job.tailoring`. The same schemas check Claude's structured output, the
// jsonb columns and the Server Actions.
import { z } from "zod";

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** Matches the `document_kind` enum. */
export const DOCUMENT_KINDS = ["cv", "cover_letter", "answers"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Documents that also get a PDF (step 10). */
export const PDF_KINDS: readonly DocumentKind[] = ["cv", "cover_letter"];

// ---------------------------------------------------------------------------
// What Claude returns when it tailors (step 8)
// ---------------------------------------------------------------------------

// As with the other structured outputs, every field is required and plain.
// The code checks the ids itself (lib/tailor/citations.ts), so a made-up id
// is flagged rather than failing the whole response.
const sources = z
  .array(z.string())
  .describe(
    "The ids of the profile facts this text is based on, such as role_ab12cd34 or hl_9f8e7d6c. At least one.",
  );

const cited = (description: string) =>
  z.object({ text: z.string().describe(description), sources });

export const tailorOutputSchema = z.object({
  cv: z.object({
    summary: cited(
      "A profile summary of 2 or 3 sentences, aimed at this role. Empty string when this part isn't requested.",
    ),
    experience: z
      .array(
        z.object({
          roleId: z.string().describe("The id of a role in the profile."),
          highlights: z
            .array(
              cited(
                "One bullet: a highlight of this role reworded for the posting.",
              ),
            )
            .describe(
              "The bullets to show for this role, most relevant first. Usually 2 to 5; fewer for old or unrelated roles.",
            ),
        }),
      )
      .describe(
        "One entry for every role in the profile, in the profile's order.",
      ),
    projects: z
      .array(
        z.object({
          projectId: z.string().describe("The id of a project in the profile."),
          highlights: z.array(cited("One bullet about this project.")),
        }),
      )
      .describe(
        "Only the projects worth showing for this role. Empty when none are.",
      ),
    skillIds: z
      .array(z.string())
      .describe(
        "The ids of the profile skills to list, most relevant to the posting first. At most 20.",
      ),
  }),
  coverLetter: z.object({
    paragraphs: z
      .array(
        cited(
          "One paragraph of the letter body, without the greeting or sign-off.",
        ),
      )
      .describe(
        "3 or 4 short paragraphs. Empty when this part isn't requested.",
      ),
  }),
  answers: z
    .array(
      z.object({
        question: z.string(),
        answer: z
          .string()
          .describe(
            "The answer in the candidate's voice. Empty string when the profile doesn't hold the answer.",
          ),
        sources,
        missing: z
          .string()
          .describe(
            "What the candidate has to add themselves because the profile doesn't say it, such as their notice period. Empty string when the answer is complete.",
          ),
      }),
    )
    .describe(
      "Answers to the questions this application is likely to ask. Empty when this part isn't requested.",
    ),
});

export type TailorOutput = z.infer<typeof tailorOutputSchema>;

// ---------------------------------------------------------------------------
// Stored documents (`document.content`)
// ---------------------------------------------------------------------------

/**
 * A piece of tailored text and the profile facts it cites. `id` is unique
 * within its document, so the claim check can point at it.
 */
export const citedTextSchema = z.object({
  id: z.string(),
  text: z.string(),
  sources: z.array(z.string()),
});
export type CitedText = z.infer<typeof citedTextSchema>;

/** Sections a CV can leave out. Experience and skills are always on. */
export const CV_SECTIONS = [
  "projects",
  "education",
  "certifications",
  "languages",
] as const;
export type CvSection = (typeof CV_SECTIONS)[number];

export const cvContentSchema = z.object({
  kind: z.literal("cv"),
  summary: citedTextSchema.nullable(),
  /** Every role in the profile, in its order, unless the owner left one out. */
  experience: z.array(
    z.object({ roleId: z.string(), highlights: z.array(citedTextSchema) }),
  ),
  projects: z.array(
    z.object({ projectId: z.string(), highlights: z.array(citedTextSchema) }),
  ),
  skillIds: z.array(z.string()),
  /** The title under the name, when the owner set one. The profile's otherwise. */
  headline: z.string().optional(),
  /**
   * The sections the owner kept, when they edited the CV. Without it, every
   * section the profile has is shown.
   */
  sections: z.array(z.enum(CV_SECTIONS)).optional(),
});

export const coverLetterContentSchema = z.object({
  kind: z.literal("cover_letter"),
  paragraphs: z.array(citedTextSchema),
});

export const answersContentSchema = z.object({
  kind: z.literal("answers"),
  items: z.array(
    citedTextSchema.extend({ question: z.string(), missing: z.string() }),
  ),
});

export const documentContentSchema = z.discriminatedUnion("kind", [
  cvContentSchema,
  coverLetterContentSchema,
  answersContentSchema,
]);

export type CvContent = z.infer<typeof cvContentSchema>;
export type CoverLetterContent = z.infer<typeof coverLetterContentSchema>;
export type AnswersContent = z.infer<typeof answersContentSchema>;
export type DocumentContent = z.infer<typeof documentContentSchema>;

// ---------------------------------------------------------------------------
// The claim check (step 9, `document.claim_flags`)
// ---------------------------------------------------------------------------

export const CLAIM_FLAG_KINDS = [
  /** Cites no fact at all. */
  "no_source",
  /** Cites an id that isn't in the profile. */
  "unknown_source",
  /** A bullet under one role or project that cites nothing from it. */
  "wrong_entry",
  /** Claude's check found the cited facts don't support it. */
  "unsupported",
] as const;
export type ClaimFlagKind = (typeof CLAIM_FLAG_KINDS)[number];

export const claimFlagSchema = z.object({
  itemId: z.string(),
  kind: z.enum(CLAIM_FLAG_KINDS),
  reason: z.string(),
  /** The flagged text, so the review can show it even when it was left out. */
  text: z.string(),
});
export type ClaimFlag = z.infer<typeof claimFlagSchema>;

/**
 * `document.claim_flags`. Flagged text is left out of the PDF and the copy
 * buttons. `checkedAt` is set once Claude has checked the claims; when that
 * check couldn't run, `checkError` says why and only the code check applied.
 */
export const claimCheckSchema = z.object({
  flags: z.array(claimFlagSchema),
  checkedAt: z.string().nullable(),
  checkError: z.string().nullable(),
});
export type ClaimCheck = z.infer<typeof claimCheckSchema>;

/**
 * What Claude returns when it checks claims (step 9): a verdict for every
 * item, with the reason written before the verdict so the model compares the
 * texts before it decides.
 */
export const claimCheckOutputSchema = z.object({
  verdicts: z
    .array(
      z.object({
        itemId: z.string().describe("The item's id, as given in brackets."),
        reason: z
          .string()
          .describe(
            "One short sentence, written before deciding: the cited fact that says what the item says, or the words in the item that no cited fact says.",
          ),
        supported: z
          .boolean()
          .describe(
            "false only when the reason names something the cited facts don't say.",
          ),
      }),
    )
    .describe("One verdict for each item, in the order given."),
});
export type ClaimCheckOutput = z.infer<typeof claimCheckOutputSchema>;

// ---------------------------------------------------------------------------
// The company snapshot (step 7, `job.company_brief`)
// ---------------------------------------------------------------------------

export type CompanyBrief = {
  /** Plain text, shown as it is. */
  text: string;
  /** The pages the brief cites. */
  sources: { url: string; title: string }[];
  createdAt: string;
};

/**
 * The brief as a command-line agent writes it (step 7). The API cites its
 * sources in the text; an agent lists them.
 */
export const companyBriefOutputSchema = z.object({
  text: z.string().describe("The brief, in plain text."),
  sources: z
    .array(z.object({ url: z.string(), title: z.string() }))
    .max(8)
    .describe("The pages the brief is based on, from the search results."),
});

// ---------------------------------------------------------------------------
// Tailoring progress (`job.tailoring`)
// ---------------------------------------------------------------------------

export const TAILOR_STAGES = [
  "queued",
  "researching",
  "writing",
  "checking",
  "rendering",
  "done",
] as const;
export type TailorStage = (typeof TAILOR_STAGES)[number];

/**
 * A question an application form asks, as the form words it, with its
 * choices when it only takes one of them.
 */
export const formQuestionSchema = z.object({
  question: z.string().trim().min(1).max(500),
  options: z.array(z.string().trim().max(300)).max(50),
});
export type FormQuestion = z.infer<typeof formQuestionSchema>;

export type TailorState = {
  /** One request: a first tailoring, or regenerating some documents. */
  requestId: string;
  kinds: DocumentKind[];
  /** The owner's note for a regenerated document. */
  note: string | null;
  /**
   * The application form's own questions, to answer instead of likely ones:
   * from the form filler, or from the posting's form when its job board
   * publishes it.
   */
  questions?: FormQuestion[];
  /**
   * The owner edited the CV on the CVs page: the new version is saved
   * already, so only its PDF is drawn.
   */
  edit?: boolean;
  status: "queued" | "running" | "succeeded" | "failed";
  stage: TailorStage;
  error: string | null;
  requestedAt: string;
  finishedAt: string | null;
};

/** A queued request for some documents, in the documents' usual order. */
export function newTailorState(
  kinds: readonly DocumentKind[],
  note: string | null,
  now = new Date(),
): TailorState {
  return {
    requestId: crypto.randomUUID(),
    kinds: DOCUMENT_KINDS.filter((kind) => kinds.includes(kind)),
    note: note || null,
    status: "queued",
    stage: "queued",
    error: null,
    requestedAt: now.toISOString(),
    finishedAt: null,
  };
}

/** A request Inngest never picked up, or never finished, after this long. */
const UNSTARTED_MS = 15 * 60 * 1000;
const UNFINISHED_MS = 60 * 60 * 1000;

export const LOST_TAILORING_MESSAGE =
  "Tailoring never finished: the Inngest server stopped or couldn't reach the app. Check that it's running, then try again.";

/** A request still marked queued or running that will never finish. */
export function isLostTailoring(state: TailorState, now = Date.now()): boolean {
  if (state.status !== "queued" && state.status !== "running") return false;
  const age = now - Date.parse(state.requestedAt);
  return (
    age > UNFINISHED_MS || (state.status === "queued" && age > UNSTARTED_MS)
  );
}

/** Whether tailoring is going, so the apply kit keeps polling. */
export function isTailoringActive(
  state: TailorState | null,
  now = Date.now(),
): boolean {
  return (
    state !== null &&
    (state.status === "queued" || state.status === "running") &&
    !isLostTailoring(state, now)
  );
}

/** Roles that can be tailored: shortlisted, or with a kit already. */
export const TAILORABLE_STATUSES = ["shortlisted", "ready"] as const;

export const NOTE_MAX = 500;

/** Tailor (all three documents) or regenerate some of them with a note. */
export const tailorRequestSchema = z.object({
  jobId: z.uuid(),
  kinds: z
    .array(z.enum(DOCUMENT_KINDS))
    .min(1, "Pick at least one document.")
    .refine(
      (kinds) => new Set(kinds).size === kinds.length,
      "Pick each document once.",
    ),
  note: z
    .string()
    .trim()
    .max(NOTE_MAX, `Keep the note under ${NOTE_MAX} characters.`),
});
export type TailorRequest = z.infer<typeof tailorRequestSchema>;

export const markAppliedSchema = z.object({ jobId: z.uuid() });
export type MarkAppliedInput = z.infer<typeof markAppliedSchema>;

/** Days after applying that the follow-up is set for. */
export const FOLLOW_UP_DAYS = 7;
