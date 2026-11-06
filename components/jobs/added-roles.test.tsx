import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AddedRoleView } from "@/lib/dal/added-roles";

import { AddedRoles } from "./added-roles";

const JOB_ID = "4f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";

const roles: AddedRoleView[] = [
  {
    id: "a1",
    site: "jobs.ashbyhq.com",
    url: "https://jobs.ashbyhq.com/lattice/1a2b",
    status: "reading",
    note: null,
    role: null,
  },
  {
    id: "a2",
    site: "boards.greenhouse.io",
    url: "https://boards.greenhouse.io/northwind/jobs/1001",
    status: "done",
    note: "Its kit is being made.",
    role: {
      id: JOB_ID,
      title: "Senior Frontend Engineer",
      company: "Northwind Labs",
      status: "shortlisted",
    },
  },
  {
    id: "a3",
    site: "careers.example.com",
    url: "https://careers.example.com/roles/frontend",
    status: "failed",
    note: "The page couldn't be read (url_not_accessible). Paste the posting's text with the link, and add it again.",
    role: null,
  },
];

describe("AddedRoles", () => {
  it("shows nothing when the owner added no role lately", () => {
    expect(renderToStaticMarkup(<AddedRoles roles={[]} />)).toBe("");
  });

  it("shows each role being read, added, or why it wasn't", () => {
    const html = renderToStaticMarkup(<AddedRoles roles={roles} />);
    expect(html).toContain("Roles you added");
    expect(html).toContain("jobs.ashbyhq.com");
    expect(html).toContain("Claude is reading the posting.");
    expect(html).toContain(`href="/jobs/${JOB_ID}"`);
    expect(html).toContain("Senior Frontend Engineer at Northwind Labs");
    expect(html).toContain("Its kit is being made.");
    expect(html).toContain("Paste the posting&#x27;s text with the link");
  });
});
