// What the form filler puts in each field of an application form, worked
// out by code from the field's label: contact details and links from the
// profile, the owner's standard answers, the tailored answers, the cover
// letter, and the tailored PDFs. Questions nothing answers go to Claude;
// personal questions (salary, demographics) are always left to the owner.
import type {
  FillFileKind,
  FillPlan,
  FormField,
} from "@/lib/schemas/extension";
import { MAX_FORM_QUESTIONS } from "@/lib/schemas/extension";

/** Everything the filler can put in a form, for one role. */
export type FillKit = {
  name: string;
  email: string;
  phone: string;
  location: string;
  currentCompany: string;
  currentTitle: string;
  links: {
    linkedin: string;
    github: string;
    portfolio: string;
    other: { label: string; url: string }[];
  };
  noticePeriod: string;
  workAuthorization: string;
  /** The owner's saved answers first, then the tailored ones that passed the claim check. */
  answers: { question: string; answer: string; saved: boolean }[];
  letterText: string | null;
  /** The tailored PDFs that exist. */
  files: FillFileKind[];
};

/** Lowercase words only: "job_application[first_name]" → "job application first name". */
export function words(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Questions the owner answers themselves, every time. */
const PERSONAL =
  /\b(gender|sex|race|racial|ethnic\w*|hispanic|latin[oa]|veteran|disabilit\w*|disabled|sexual|orientation|pronouns?|religio\w*|birth|age|marital|ssn|social security|passport|national id\w*|salary|compensation|pay|rate|wage|expected pay|desired pay)\b/;

type Rule = {
  test: RegExp;
  value: (kit: FillKit) => string;
  /** Its answer can pick a dropdown's or radio group's choice by itself. */
  picks?: true;
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";
const lastName = (name: string) => name.trim().split(/\s+/).slice(1).join(" ");

/**
 * Short detail fields, matched on their label, name and autocomplete hint.
 * First match wins, so the narrow rules come before the broad ones.
 */
const DETAIL_RULES: Rule[] = [
  {
    test: /\b(first|given|fore) ?name\b|\bfname\b/,
    value: (k) => firstName(k.name),
  },
  {
    test: /\b(last|family|sur) ?name\b|\blname\b|\bsurname\b/,
    value: (k) => lastName(k.name),
  },
  { test: /\blinked ?in\b/, value: (k) => k.links.linkedin },
  { test: /\bgit ?hub\b/, value: (k) => k.links.github },
  {
    test: /\btwitter\b/,
    value: (k) => otherLink(k, /twitter|x\.com/i),
  },
  {
    test: /\bportfolio\b|\bweb ?site\b|\bpersonal (site|page)\b|\bblog\b/,
    value: (k) => k.links.portfolio,
  },
  { test: /\be ?mail\b/, value: (k) => k.email },
  { test: /\b(phone|mobile|cell|telephone|tel)\b/, value: (k) => k.phone },
  {
    test: /\b(current|present|most recent) (company|employer)\b|\borganization\b/,
    value: (k) => k.currentCompany,
  },
  {
    test: /\b(current|present|most recent) (job )?title\b/,
    value: (k) => k.currentTitle,
  },
  {
    test: /\b(location|city|country|address level2)\b/,
    value: (k) => k.location,
  },
  {
    test: /^(full |legal |your )?name\b|\bfull name\b|\bcandidate name\b/,
    value: (k) => k.name,
  },
];

/** Questions a standard answer covers, matched on the label alone. */
const QUESTION_RULES: Rule[] = [
  {
    test: /\bnotice period\b|\bwhen can you start\b|\bearliest start\b|\bstart date\b|\bavailab\w* to start\b/,
    value: (k) => k.noticePeriod,
    picks: true,
  },
  {
    test: /\b(authori[sz]\w*|eligib\w*|right) to work\b|\bwork (authori[sz]ation|permit)\b|\bvisa\b|\bsponsor\w*\b/,
    value: (k) => k.workAuthorization,
  },
  {
    test: /^(where are you (based|located)|(current )?location|city|country of residence)\b/,
    value: (k) => k.location,
  },
];

function otherLink(kit: FillKit, pattern: RegExp): string {
  return (
    kit.links.other.find(
      (link) => pattern.test(link.label) || pattern.test(link.url),
    )?.url ?? ""
  );
}

const STOP = new Set(
  "a an the to of in on for and or is are be you your we our us with this that do does did have has will would what why how which who when where please describe tell about at as by it its if any".split(
    " ",
  ),
);

const tokens = (text: string) =>
  new Set(
    words(text)
      .split(" ")
      .filter((word) => word.length > 1 && !STOP.has(word)),
  );

/** How alike two questions are: the share of their content words they have in common. */
export function similarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const word of x) if (y.has(word)) shared += 1;
  return shared / (x.size + y.size - shared);
}

const SAME_QUESTION = 0.6;

/** The best answer to a question, if one is close enough. */
function answerFor(
  kit: FillKit,
  question: string,
): { answer: string; saved: boolean } | null {
  let best: { answer: string; saved: boolean; score: number } | null = null;
  for (const { question: asked, answer, saved } of kit.answers) {
    const score =
      words(asked) === words(question) ? 1 : similarity(asked, question);
    if (score >= SAME_QUESTION && (!best || score > best.score)) {
      best = { answer, saved, score };
    }
  }
  return best;
}

/** The option that matches an answer, for a select or radio group. */
export function pickOption(options: string[], answer: string): string | null {
  const wanted = words(answer);
  if (wanted === "") return null;
  const exact = options.find((option) => words(option) === wanted);
  if (exact) return exact;
  // "Yes, I am authorized" picks "Yes".
  const lead = options.find((option) => {
    const word = words(option);
    return word !== "" && wanted.startsWith(`${word} `);
  });
  return lead ?? null;
}

const COVER_LETTER = /\bcover ?letter\b|\bmotivation(al)? letter\b/;
const LETTER_FALLBACK =
  /\badditional information\b|\banything else\b|\bmessage to\b|\bcomments?\b/;
const RESUME = /\b(resume|cv|curriculum vitae)\b/;

/** A label that reads as a question rather than a short detail. */
const isQuestion = (field: FormField) =>
  field.kind === "textarea" ||
  field.kind === "select" ||
  field.kind === "radio" ||
  field.label.trim().endsWith("?") ||
  words(field.label).split(" ").length >= 5;

/**
 * Plans the filling of one form. Every field ends up in exactly one of the
 * plan's lists: filled, given a file, asked of Claude, or left.
 */
export function planFill(fields: readonly FormField[], kit: FillKit): FillPlan {
  const plan: FillPlan = {
    values: [],
    files: [],
    questions: [],
    asked: [],
    left: [],
  };
  let letterUsed = false;
  const fileFields = fields.filter((field) => field.kind === "file");

  for (const field of fields) {
    const text = words(`${field.label} ${field.name} ${field.autocomplete}`);
    const label = words(field.label);

    if (field.kind === "file") {
      const kind: FillFileKind | null = COVER_LETTER.test(text)
        ? "cover_letter"
        : RESUME.test(text) || fileFields.length === 1
          ? "cv"
          : null;
      if (kind && kit.files.includes(kind)) {
        plan.files.push({ key: field.key, kind });
        if (kind === "cover_letter") letterUsed = true;
      } else {
        plan.left.push(field.key);
      }
      continue;
    }

    if (PERSONAL.test(label || text)) {
      plan.left.push(field.key);
      continue;
    }

    if (
      field.kind === "textarea" &&
      COVER_LETTER.test(text) &&
      kit.letterText
    ) {
      plan.values.push({ key: field.key, value: kit.letterText });
      letterUsed = true;
      continue;
    }

    const choices = field.kind === "select" || field.kind === "radio";
    const found = field.label ? answerFor(kit, field.label) : null;
    if (found !== null) {
      const value = choices
        ? pickOption(field.options, found.answer)
        : found.answer;
      if (value) {
        plan.values.push({ key: field.key, value });
        // A tailored answer is asked again with the rest of the form's
        // questions, so a new set of answers covers the whole form.
        if (!found.saved) plan.asked.push(asQuestion(field));
        continue;
      }
    }

    // A notice period that names one of the choices needs no Claude call.
    // Other choices are better answered by Claude, which reads the whole
    // question: "No" can mean yes to a question worded the other way.
    if (choices) {
      const standard = QUESTION_RULES.find(
        (candidate) => candidate.picks && candidate.test.test(label),
      );
      const picked = standard
        ? pickOption(field.options, standard.value(kit))
        : null;
      if (picked) {
        plan.values.push({ key: field.key, value: picked });
        continue;
      }
    }

    const question = isQuestion(field);
    const rule = choices
      ? undefined
      : question
        ? QUESTION_RULES.find((candidate) => candidate.test.test(label))
        : (DETAIL_RULES.find((candidate) => candidate.test.test(text)) ??
          QUESTION_RULES.find((candidate) => candidate.test.test(label)));
    const value = rule?.value(kit).trim();
    if (value) {
      plan.values.push({ key: field.key, value });
      continue;
    }
    if (rule) {
      // A detail the profile doesn't have: the owner adds it.
      plan.left.push(field.key);
      continue;
    }

    if (field.label && question) {
      plan.questions.push(asQuestion(field));
      plan.asked.push(asQuestion(field));
    } else {
      plan.left.push(field.key);
    }
  }

  // With nowhere else for it, the letter goes in a free-text box.
  if (!letterUsed && kit.letterText) {
    const box = plan.questions.find((question) =>
      LETTER_FALLBACK.test(words(question.question)),
    );
    const field = box && fields.find((f) => f.key === box.key);
    if (box && field?.kind === "textarea") {
      plan.questions = plan.questions.filter((question) => question !== box);
      plan.asked = plan.asked.filter((question) => question.key !== box.key);
      plan.values.push({ key: box.key, value: kit.letterText });
    }
  }

  // Beyond the cap, the rest wait for the owner.
  const kept = new Set(
    plan.asked.slice(0, MAX_FORM_QUESTIONS).map((question) => question.key),
  );
  plan.left.push(
    ...plan.questions
      .filter((question) => !kept.has(question.key))
      .map((question) => question.key),
  );
  plan.questions = plan.questions.filter((question) => kept.has(question.key));
  plan.asked = plan.asked.filter((question) => kept.has(question.key));
  return plan;
}

const FILE_NAMES: Record<FillFileKind, string> = {
  cv: "CV",
  cover_letter: "Cover letter",
};

/**
 * The name an attached PDF has on the employer's side: "Jordan Sample -
 * CV.pdf", not one more "CV.pdf" in a recruiter's pile.
 */
export function attachmentName(ownerName: string, kind: FillFileKind): string {
  const owner = ownerName
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${[owner, FILE_NAMES[kind]].filter(Boolean).join(" - ")}.pdf`;
}

function asQuestion(field: FormField) {
  return {
    key: field.key,
    question: field.label.trim().slice(0, 500),
    options:
      field.kind === "select" || field.kind === "radio"
        ? field.options.slice(0, 50)
        : [],
  };
}
