import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ApplyKit, KitDocument } from "@/lib/dal/apply-kit";
import { applyKitQuery, roleEmailsQuery } from "@/lib/jobs/queries";
import type { ClaimFlag } from "@/lib/schemas/tailor";

vi.mock("@/app/(app)/jobs/actions", () => ({}));
vi.mock("@/app/(app)/cvs/actions", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { ApplyKitView } = await import("./apply-kit");

const JOB_ID = "4f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
const AI_POLICY = "Please don't use AI tools to write your answers.";

const emptyKit: ApplyKit = {
  job: {
    id: JOB_ID,
    title: "Senior Frontend Engineer",
    company: "Northwind Labs",
    url: "https://boards.greenhouse.io/northwindlabs/jobs/4012345",
    applyUrl: null,
    status: "shortlisted",
    score: 86,
    workplace: "remote",
    places: ["Europe"],
    salary: { min: 60000, max: 72000, currency: "EUR", period: "year" },
    aiPolicy: null,
    applicationRules: [],
    deadline: null,
  },
  tailoring: null,
  canTailor: true,
  brief: null,
  cv: null,
  letter: null,
  answers: null,
  standardAnswers: [],
  missingAnswers: [],
  costUsd: 0,
  application: null,
};

function kitDocument(
  kind: KitDocument["kind"],
  flags: ClaimFlag[] = [],
): KitDocument {
  return {
    id: `doc-${kind}`,
    kind,
    version: 1,
    readyAt: "2026-10-18T10:00:00.000Z",
    note: null,
    edited: false,
    pdfUrl: kind === "answers" ? null : `/api/documents/doc-${kind}/pdf`,
    flags,
    checkedAt: "2026-10-18T10:01:00.000Z",
    checkError: null,
  };
}

const header = {
  name: "Jordan Lee",
  contact: ["jordan@example.com", "Lisbon, Portugal"],
  links: [],
};

const readyKit: ApplyKit = {
  ...emptyKit,
  cv: {
    document: kitDocument("cv", [
      {
        itemId: "role_00000005:2",
        kind: "unsupported",
        reason: "Mentored 3, didn't lead 12.",
        text: "Led a team of 12 engineers.",
      },
      {
        itemId: "role_00000005:3",
        kind: "unknown_source",
        reason: "Cites a fact that isn't in the profile.",
        text: "Cut load times by 90%.",
      },
    ]),
    view: {
      ...header,
      headline: "Senior frontend engineer",
      summary: "Frontend engineer for data-heavy React products.",
      experience: [
        {
          id: "role_00000005",
          title: "Lead Frontend Engineer",
          company: "Northwind Analytics",
          location: "Remote",
          dates: "Mar 2021 – now",
          highlights: ["Rebuilt the reporting dashboard in React."],
          technologies: [],
        },
      ],
      projects: [],
      skills: ["React", "TypeScript"],
      skillGroups: [{ category: "Other", names: ["React", "TypeScript"] }],
      education: [],
      certifications: [],
      languages: [],
    },
    diff: {
      summary: { before: "", after: null, changes: null, flag: null },
      entries: [
        {
          id: "role_00000005",
          title: "Lead Frontend Engineer, Northwind Analytics",
          bullets: [
            {
              id: "role_00000005:0",
              text: "Rebuilt the reporting dashboard in React.",
              from: [
                {
                  id: "hl_00000012",
                  text: "Rebuilt the reporting dashboard in React and D3.",
                },
              ],
              changes: null,
              flag: null,
            },
          ],
          leftOut: [],
        },
      ],
      skills: { shown: ["React", "TypeScript"], leftOut: [] },
      orphans: [],
    },
    keywords: [
      { term: "React", onCv: true, inProfile: true },
      { term: "Figma", onCv: false, inProfile: true },
      { term: "GraphQL", onCv: false, inProfile: false },
    ],
    skillsToAdd: [],
  },
  letter: {
    document: kitDocument("cover_letter"),
    view: {
      ...header,
      greeting: "Dear Northwind Labs hiring team,",
      paragraphs: ["I build data-heavy React products."],
      closing: "Kind regards,",
    },
    text: "Dear Northwind Labs hiring team,",
  },
  answers: {
    document: kitDocument("answers"),
    items: [
      {
        id: "a0",
        question: "Why are you interested in this role?",
        answer: "Your analytics tools are close to what I build.",
        missing: "",
        flag: null,
        fromStandard: false,
      },
      {
        id: "a2",
        question: "What is your notice period?",
        answer: "",
        missing: "Your notice period. Add it to your standard answers.",
        flag: null,
        fromStandard: false,
      },
    ],
  },
  costUsd: 0.078,
};

/** Renders the kit as the page hands it over: already in the cache. */
function render(kit: ApplyKit): string {
  const queryClient = new QueryClient();
  queryClient.setQueryData(applyKitQuery(kit.job.id).queryKey, kit);
  queryClient.setQueryData(roleEmailsQuery(kit.job.id).queryKey, []);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ApplyKitView jobId={kit.job.id} />
    </QueryClientProvider>,
  );
}

describe("the apply kit page", () => {
  it("shows the posting's rule on AI use at the top", () => {
    const html = render({
      ...emptyKit,
      job: { ...emptyKit.job, aiPolicy: AI_POLICY },
    });
    expect(html).toContain("This posting has a rule on using AI");
    expect(html).toContain("Please don&#x27;t use AI tools");
    // Before the button that starts tailoring.
    expect(html.indexOf("rule on using AI")).toBeLessThan(
      html.indexOf("Write the kit"),
    );
  });

  it("says nothing about AI when the posting has no rule", () => {
    expect(render(emptyKit)).not.toContain("rule on using AI");
  });

  it("shows tailoring's progress while it runs", () => {
    const html = render({
      ...emptyKit,
      tailoring: {
        requestId: "r1",
        kinds: ["cv", "cover_letter", "answers"],
        note: null,
        status: "running",
        stage: "writing",
        error: null,
        requestedAt: new Date().toISOString(),
        finishedAt: null,
      },
    });
    expect(html).toContain("Tailoring your application");
    expect(html).toContain("Writing the documents");
    expect(html).not.toContain("Write the kit");
  });

  it("shows what was sent once applied", () => {
    const html = render({
      ...emptyKit,
      job: { ...emptyKit.job, status: "applied" },
      canTailor: false,
      application: {
        appliedAt: "2026-10-18T12:00:00.000Z",
        followUpOn: "2026-10-25",
        documents: [
          { kind: "cv", version: 2 },
          { kind: "cover_letter", version: 1 },
        ],
      },
    });
    expect(html).toContain("You sent CV v2 and cover letter v1.");
    expect(html).not.toContain("Mark as applied");
  });

  it("opens on the CV, with what was left out of it", () => {
    const html = render(readyKit);
    expect(html).toContain("The documents are ready.");
    expect(html).toMatch(/aria-selected="true"[^>]*>CV</);
    expect(html).toContain("2 claims left out");
    expect(html).toContain("Rebuilt the reporting dashboard in React.");
    expect(html).toContain("Download PDF");
    // The other tabs aren't drawn until they're opened.
    expect(html).not.toContain("I build data-heavy React products.");
  });

  it("shows which of the posting's keywords the CV uses", () => {
    const html = render(readyKit);
    expect(html).toContain("ATS keywords");
    expect(html).toMatch(/1 of 3<\/span> of the posting&#x27;s keywords/);
    expect(html).toContain('Figma<span class="sr-only">, in your profile');
    expect(html).toContain("Grey ones are in your profile but not on this CV.");
    expect(html).toContain("use Edit to put it on this CV");

    const noPosting = render({
      ...readyKit,
      cv: { ...readyKit.cv!, keywords: [] },
    });
    expect(noPosting).not.toContain("ATS keywords");
  });

  it("offers to add profile skills the posting asks for to the CV", () => {
    const withSkills: ApplyKit = {
      ...readyKit,
      cv: {
        ...readyKit.cv!,
        skillsToAdd: [
          { id: "skill_00000030", name: "Figma" },
          { id: "skill_00000099", name: "GraphQL" },
        ],
      },
    };
    const html = render(withSkills);
    expect(html).toContain(
      'Your profile lists <span class="font-medium text-foreground">Figma and GraphQL</span>',
    );
    expect(html).toContain("Add to CV");

    // Not while Claude writes the kit, nor once it has gone out.
    expect(
      render({
        ...withSkills,
        tailoring: {
          requestId: "r1",
          kinds: ["cv"],
          note: null,
          status: "running",
          stage: "rendering",
          error: null,
          requestedAt: new Date().toISOString(),
          finishedAt: null,
          edit: true,
        },
      }),
    ).not.toContain("Add to CV");
    expect(render({ ...withSkills, canTailor: false })).not.toContain(
      "Add to CV",
    );
    expect(render(readyKit)).not.toContain("Add to CV");
  });

  it("lists the kit's parts, and the answers only the owner can give", () => {
    const html = render(readyKit);
    expect(html).toContain("1 of 2 ready · 1 only you can answer");
    expect(html).toContain("PDF ready · 2 left out");
    expect(html).toContain("Mark as applied");
    // Nothing to tick off: the kit is to read.
    expect(html).not.toContain('role="checkbox"');
  });

  it("offers to prepare a kit for a role the app passed over", () => {
    const html = render({
      ...emptyKit,
      job: { ...emptyKit.job, status: "skipped" },
      canTailor: false,
    });
    expect(html).toContain("The app passed over this role.");
    expect(html).toContain("Prepare kit");
    expect(html).not.toContain("Mark as applied");
  });

  it("shows the role's match, place and pay at the top", () => {
    const html = render(readyKit);
    expect(html).toContain(
      "Northwind Labs · Remote, Europe · EUR 60K–72K a year",
    );
    expect(html).toContain("Match score 86 of 100");
  });

  it("shows what the kit cost", () => {
    expect(render(readyKit)).toContain("This kit cost");
    expect(render(readyKit)).toContain("$0.078");
    expect(render(emptyKit)).toContain("Nothing spent on this kit yet");
  });
});
