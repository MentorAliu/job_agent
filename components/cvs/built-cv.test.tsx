import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BuiltCvDetail } from "@/lib/dal/cvs";
import { builtCvQuery } from "@/lib/cvs/queries";

import { BuiltCvView } from "./built-cv";

const CV_ID = "7c2e9a41-3b5d-4f6e-8a1b-9c0d1e2f3a4b";

const writing: BuiltCvDetail = {
  id: CV_ID,
  edited: false,
  request: {
    targetTitle: "Senior Frontend Engineer",
    jobText: "We want React and GraphQL.",
    skills: ["React", "TypeScript"],
    length: "one_page",
    sections: ["education"],
    note: "Stress mentoring.",
  },
  status: "checking",
  error: null,
  createdAt: new Date().toISOString(),
  readyAt: null,
  pageCount: null,
  trimmed: 0,
  pdfUrl: null,
  keywords: [],
  flags: [],
  lines: 0,
  checkedAt: null,
  checkError: null,
};

const ready: BuiltCvDetail = {
  ...writing,
  status: "ready",
  readyAt: new Date().toISOString(),
  pageCount: 1,
  trimmed: 2,
  pdfUrl: `/api/cvs/${CV_ID}/pdf`,
  keywords: [
    { term: "React", onCv: true, inProfile: true },
    { term: "Figma", onCv: false, inProfile: true },
    { term: "GraphQL", onCv: false, inProfile: false },
  ],
  lines: 9,
  checkedAt: new Date().toISOString(),
};

function render(cv: BuiltCvDetail) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(builtCvQuery(cv.id).queryKey, cv);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <BuiltCvView id={cv.id} />
    </QueryClientProvider>,
  );
}

describe("a built CV's page", () => {
  it("shows the steps while Claude writes it", () => {
    const html = render(writing);
    expect(html).toContain("Building your CV");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Checking every claim");
    expect(html).not.toContain("Build another like this");
  });

  it("shows the ATS check, keyword coverage and what was asked for", () => {
    const html = render(ready);
    expect(html).toContain("ATS check");
    expect(html).toContain("1 page, with 2 older lines left out to fit.");
    expect(html).toContain("All 9 claims cite");
    expect(html).not.toContain("claims left out");
    expect(html).toContain("1 of 3");
    expect(html).toContain(", not in your profile");
    expect(html).toContain(", in your profile but not on this CV");
    expect(html).toContain("Leads with");
    expect(html).toContain("React, TypeScript");
    expect(html).toContain("Summary, Skills, Experience, Education");
    expect(html).toContain(`href="/cvs/new?from=${CV_ID}"`);
  });

  it("lists the claims left out of the PDF", () => {
    const html = render({
      ...ready,
      flags: [
        {
          itemId: "role_00000005:2",
          kind: "unsupported",
          reason: "The cited fact says the candidate mentored 3 juniors.",
          text: "Led a team of 12 engineers.",
        },
      ],
    });
    expect(html).toContain("1 claim left out");
    expect(html).toContain("left out of the PDF.");
    expect(html).not.toContain("copy buttons");
    expect(html).not.toContain("All 9 claims cite");
  });

  it("says why a CV didn't finish, with a way to build it again", () => {
    const html = render({
      ...writing,
      status: "failed",
      error: "Claude declined to write this CV.",
    });
    expect(html).toContain("This CV didn&#x27;t finish");
    expect(html).toContain("Claude declined to write this CV.");
    expect(html).toContain("Build it again");
  });
});
