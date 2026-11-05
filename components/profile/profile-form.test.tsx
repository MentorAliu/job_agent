import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { masterProfileSchema } from "@/lib/schemas/profile";
import profileJson from "@/test/fixtures/profile.json";

vi.mock("@/app/(app)/profile/actions", () => ({}));

const { ProfileForm } = await import("./profile-form");
const { count, dateRange, formatMonth } = await import("./format");

const profile = masterProfileSchema.parse(profileJson);

/** The page's text, without tags. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("formatMonth", () => {
  it("writes a month as its short name and the year", () => {
    expect(formatMonth("2022-09")).toBe("Sep 2022");
  });

  it("leaves a year, or anything it can't read, as it is", () => {
    expect(formatMonth("2019")).toBe("2019");
    expect(formatMonth("2022-13")).toBe("2022-13");
    expect(formatMonth(" ")).toBe("");
  });
});

describe("dateRange", () => {
  it("joins the start and the end", () => {
    expect(dateRange("2019-06", "2022-02")).toBe("Jun 2019 to Feb 2022");
  });

  it("ends a current role now", () => {
    expect(dateRange("2022-03", "", true)).toBe("Mar 2022 to now");
  });

  it("shows as much as is known", () => {
    expect(dateRange("2018", "")).toBe("2018");
    expect(dateRange("", "2019")).toBe("until 2019");
    expect(dateRange("", "")).toBe("");
  });
});

describe("count", () => {
  it("picks one or many", () => {
    expect(count(1, "role")).toBe("1 role");
    expect(count(5, "role")).toBe("5 roles");
    expect(count(0, "entry", "entries")).toBe("0 entries");
  });
});

describe("ProfileForm", () => {
  const html = renderToStaticMarkup(
    <ProfileForm defaultValues={profile} cvFileId={null} />,
  );

  it("opens the first role and keeps the other entries closed", () => {
    const expanded = [...html.matchAll(/aria-expanded="(true|false)"/g)].map(
      (match) => match[1],
    );
    // Three roles, two projects, one school and one certification.
    expect(expanded).toEqual([
      "true",
      "false",
      "false",
      "false",
      "false",
      "false",
      "false",
    ]);
  });

  it("sums up each closed entry", () => {
    const page = text(html);
    expect(page).toContain(
      "Frontend Engineer Blue Harbor Software · Podgorica, Montenegro · Jun 2019 to Feb 2022 2 bullets",
    );
    expect(page).toContain("3 roles · 6 bullets");
    expect(page).toContain("14 skills");
    expect(page).not.toContain("Needs fixing");
  });

  it("lists every part in the menu, with its count", () => {
    const menu = text(html.slice(html.indexOf("<nav")));
    expect(menu).toMatch(
      /^On this page Basics Experience 3 Skills 14 Projects 2 Education 1 Certifications 1 Languages 2 Links 3/,
    );
  });

  it("says when a part is empty", () => {
    const empty = text(
      renderToStaticMarkup(
        <ProfileForm
          defaultValues={{ ...profile, projects: [] }}
          cvFileId="0f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e"
        />,
      ),
    );
    expect(empty).toContain("Projects None yet");
    expect(empty).toContain("No projects yet.");
    expect(empty).toContain("Save profile from this CV");
  });
});
