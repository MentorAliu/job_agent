import { describe, expect, it } from "vitest";

import type { FormField } from "@/lib/schemas/extension";

import {
  attachmentName,
  pickOption,
  planFill,
  similarity,
  words,
  type FillKit,
} from "./fill";

const kit: FillKit = {
  name: "Jordan Q Sample",
  email: "jordan@example.com",
  phone: "+382 67 000 000",
  location: "Podgorica, Montenegro",
  currentCompany: "Northwind Labs",
  currentTitle: "Senior Frontend Engineer",
  links: {
    linkedin: "https://linkedin.com/in/jordan",
    github: "https://github.com/jordan",
    portfolio: "https://jordan.example",
    other: [{ label: "Twitter", url: "https://x.com/jordan" }],
  },
  noticePeriod: "1 month",
  workAuthorization: "Based in Montenegro; remote as a contractor.",
  answers: [
    { question: "How did you hear about us?", answer: "LinkedIn", saved: true },
    {
      question: "Why do you want to work at Prezly?",
      answer: "Because of the product.",
      saved: false,
    },
  ],
  letterText: "Dear Prezly team,\n\nI build…",
  files: ["cv", "cover_letter"],
};

let n = 0;
const field = (label: string, extra: Partial<FormField> = {}): FormField => ({
  key: String((n += 1)),
  kind: "text",
  label,
  name: "",
  autocomplete: "",
  options: [],
  ...extra,
});

const valueOf = (plan: ReturnType<typeof planFill>, f: FormField) =>
  plan.values.find((value) => value.key === f.key)?.value;

describe("words", () => {
  it("turns names and labels into plain words", () => {
    expect(words("job_application[first_name]")).toBe(
      "job application first name",
    );
    expect(words("lastName")).toBe("last name");
  });
});

describe("planFill", () => {
  it("fills contact details and links from the profile", () => {
    const first = field("First Name");
    const last = field("", { name: "job_application[last_name]" });
    const email = field("Email", { kind: "email" });
    const phone = field("Phone");
    const city = field("", { autocomplete: "address-level2" });
    const linkedin = field("LinkedIn Profile", { kind: "url" });
    const github = field("GitHub URL");
    const twitter = field("Twitter URL");
    const site = field("Website");
    const company = field("Current company");
    const full = field("Full name");
    const plan = planFill(
      [
        first,
        last,
        email,
        phone,
        city,
        linkedin,
        github,
        twitter,
        site,
        company,
        full,
      ],
      kit,
    );
    expect(valueOf(plan, first)).toBe("Jordan");
    expect(valueOf(plan, last)).toBe("Q Sample");
    expect(valueOf(plan, email)).toBe("jordan@example.com");
    expect(valueOf(plan, phone)).toBe("+382 67 000 000");
    expect(valueOf(plan, city)).toBe("Podgorica, Montenegro");
    expect(valueOf(plan, linkedin)).toBe("https://linkedin.com/in/jordan");
    expect(valueOf(plan, github)).toBe("https://github.com/jordan");
    expect(valueOf(plan, twitter)).toBe("https://x.com/jordan");
    expect(valueOf(plan, site)).toBe("https://jordan.example");
    expect(valueOf(plan, company)).toBe("Northwind Labs");
    expect(valueOf(plan, full)).toBe("Jordan Q Sample");
    expect(plan.left).toEqual([]);
    expect(plan.questions).toEqual([]);
  });

  it("attaches the CV and the cover letter to the right file fields", () => {
    const resume = field("Resume/CV", { kind: "file" });
    const letter = field("Cover Letter", { kind: "file" });
    const plan = planFill([resume, letter], kit);
    expect(plan.files).toEqual([
      { key: resume.key, kind: "cv" },
      { key: letter.key, kind: "cover_letter" },
    ]);
  });

  it("uses saved and tailored answers, and the standard ones", () => {
    const heard = field("How did you hear about us?", { kind: "textarea" });
    const why = field("Why do you want to work at Prezly?", {
      kind: "textarea",
    });
    const notice = field("What is your notice period?");
    const visa = field("Are you authorized to work in the EU?", {
      kind: "textarea",
    });
    const plan = planFill([heard, why, notice, visa], kit);
    expect(valueOf(plan, heard)).toBe("LinkedIn");
    expect(valueOf(plan, why)).toBe("Because of the product.");
    expect(valueOf(plan, notice)).toBe("1 month");
    expect(valueOf(plan, visa)).toBe(
      "Based in Montenegro; remote as a contractor.",
    );
    // Only the tailored answer is asked again if a new set is written.
    expect(plan.asked.map((question) => question.key)).toEqual([why.key]);
    expect(plan.questions).toEqual([]);
  });

  it("asks Claude the questions nothing answers, with their choices", () => {
    const sponsor = field(
      "Will you now or in the future require sponsorship?",
      {
        kind: "select",
        options: ["Yes", "No"],
      },
    );
    const why = field("Why do you want to work at Prezly?", {
      kind: "textarea",
    });
    const stack = field("Describe a hard frontend bug you fixed", {
      kind: "textarea",
    });
    const plan = planFill([sponsor, why, stack], kit);
    expect(plan.questions).toEqual([
      {
        key: sponsor.key,
        question: "Will you now or in the future require sponsorship?",
        options: ["Yes", "No"],
      },
      {
        key: stack.key,
        question: "Describe a hard frontend bug you fixed",
        options: [],
      },
    ]);
    expect(plan.asked.map((question) => question.key)).toEqual([
      sponsor.key,
      why.key,
      stack.key,
    ]);
  });

  it("picks the notice period's choice itself, and asks Claude when none fits", () => {
    const notice = field("Notice period", {
      kind: "select",
      options: ["Select…", "Immediately", "2 weeks", "1 month", "3 months"],
    });
    const start = field("When can you start?", {
      kind: "radio",
      options: ["Right away", "Within 3 months"],
    });
    const plan = planFill([notice, start], kit);
    expect(valueOf(plan, notice)).toBe("1 month");
    expect(plan.asked).toEqual([
      {
        key: start.key,
        question: "When can you start?",
        options: ["Right away", "Within 3 months"],
      },
    ]);
  });

  it("leaves salary and demographic questions to the owner", () => {
    const salary = field("What are your salary expectations?");
    const gender = field("Gender", {
      kind: "select",
      options: ["Female", "Male"],
    });
    const veteran = field("Veteran status", {
      kind: "radio",
      options: ["Yes", "No"],
    });
    const plan = planFill([salary, gender, veteran], kit);
    expect(plan.left).toEqual([salary.key, gender.key, veteran.key]);
    expect(plan.values).toEqual([]);
    expect(plan.questions).toEqual([]);
  });

  it("puts the letter in a free-text box when there's no cover letter field", () => {
    const extra = field("Additional information", { kind: "textarea" });
    const plan = planFill([extra], kit);
    expect(valueOf(plan, extra)).toBe(kit.letterText);
    expect(plan.asked).toEqual([]);
  });

  it("leaves a detail the profile doesn't have, and short unknown fields", () => {
    const plan = planFill([field("Phone"), field("Middle name")], {
      ...kit,
      phone: "",
    });
    expect(plan.left).toHaveLength(2);
  });
});

describe("similarity and pickOption", () => {
  it("matches a question worded a little differently", () => {
    expect(
      similarity(
        "Why do you want to work at Prezly?",
        "Please describe why you want to work at Prezly",
      ),
    ).toBeGreaterThanOrEqual(0.6);
    expect(similarity("Notice period?", "Salary expectations?")).toBe(0);
  });

  it("picks the option an answer names", () => {
    expect(pickOption(["Yes", "No"], "No")).toBe("No");
    expect(pickOption(["Yes", "No"], "Yes, I am")).toBe("Yes");
    expect(pickOption(["Yes", "No"], "Maybe")).toBeNull();
  });
});

describe("attachmentName", () => {
  it("names a PDF after the owner, without characters file names can't hold", () => {
    expect(attachmentName("Jordan Sample", "cv")).toBe(
      "Jordan Sample - CV.pdf",
    );
    expect(attachmentName("Jordan / Sample", "cover_letter")).toBe(
      "Jordan Sample - Cover letter.pdf",
    );
    expect(attachmentName("  ", "cv")).toBe("CV.pdf");
  });
});
