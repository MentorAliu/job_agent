import { describe, expect, it } from "vitest";

import { cvView } from "@/lib/documents/view";
import { cvEditFormSchema, type CvEditForm } from "@/lib/schemas/cv-editor";
import { masterProfileSchema, type MasterProfile } from "@/lib/schemas/profile";
import {
  tailorOutputSchema,
  type ClaimCheck,
  type CvContent,
} from "@/lib/schemas/tailor";
import { toDocuments } from "@/lib/tailor/citations";
import { factIndex, profileFacts } from "@/lib/tailor/facts";
import tailored from "@/test/fixtures/claude/tailor-response.json";
import profileJson from "@/test/fixtures/profile.json";

import {
  CvEditError,
  editedContent,
  editorStart,
  type EditFrom,
} from "./editor";

const profile: MasterProfile = masterProfileSchema.parse(profileJson);
const [doc] = toDocuments(
  tailorOutputSchema.parse(JSON.parse(tailored.body.content[0].text)),
  ["cv"],
  profile,
  factIndex(profileFacts(profile, null)),
);
const content = doc.content as CvContent;
// The code check flags the made-up source; Claude's, the "team of 12".
const check: ClaimCheck = {
  flags: [
    ...doc.flags,
    {
      itemId: "role_00000005:2",
      kind: "unsupported",
      reason: "No fact says 12.",
      text: "Led a team of 12 engineers through the dashboard rebuild.",
    },
  ],
  checkedAt: "2026-10-19T10:00:00.000Z",
  checkError: null,
};
const from: EditFrom = {
  content,
  check,
  title: "Lead Frontend Engineer",
  sections: ["projects", "education", "languages"],
  length: "one_page",
  template: "executive",
};

const refs = (form: CvEditForm, roleId: string) =>
  form.experience
    .find((entry) => entry.roleId === roleId)
    ?.lines.map((line) => line.ref);

describe("editorStart", () => {
  it("opens with everything in the profile, as the uploaded CV had it", () => {
    const { form, catalogue } = editorStart(profile, null, "modern");
    expect(cvEditFormSchema.safeParse(form).success).toBe(true);
    expect(form.title).toBe("Senior Frontend Engineer");
    expect(form.summary).toBe(profile.basics.summary);
    expect(form.experience.every((entry) => entry.shown)).toBe(true);
    expect(refs(form, "role_00000005")).toEqual([
      "fact:hl_00000006",
      "fact:hl_00000007",
      "fact:hl_00000008",
    ]);
    expect(form.skillIds).toEqual(profile.skills.map((skill) => skill.id));
    expect(form.sections).toEqual(["education", "certifications", "languages"]);
    expect(form.length).toBe("one_page");
    // The design set in Settings.
    expect(form.template).toBe("modern");
    expect(catalogue.roles[0]).toMatchObject({
      title: "Senior Frontend Engineer, Northwind Analytics",
    });
  });

  it("keeps a CV's own design, and gives a kit's CV the Settings one", () => {
    expect(editorStart(profile, from, "modern").form.template).toBe(
      "executive",
    );
    const kit = { ...from, template: null };
    expect(editorStart(profile, kit, "minimal").form.template).toBe("minimal");
    const { form } = editorStart(profile, from, "modern");
    expect(
      editedContent({ ...form, template: "classic" }, profile, from).content
        .template,
    ).toBe("classic");
  });

  it("opens a CV with the lines it shows, and offers the profile's other bullets", () => {
    const { form, catalogue } = editorStart(profile, from, "modern");
    expect(cvEditFormSchema.safeParse(form).success).toBe(true);
    expect(form.title).toBe("Lead Frontend Engineer");
    expect(form.summary).toMatch(/^Senior frontend engineer with 7 years/);
    // The flagged lines aren't on it, and can't be added back.
    expect(refs(form, "role_00000005")).toEqual([
      "cv:role_00000005:0",
      "cv:role_00000005:1",
      "cv:role_00000005:3",
    ]);
    expect(refs(form, "role_00000009")).toEqual([
      "cv:role_00000009:0",
      "cv:role_00000009:1",
    ]);
    const [northwind, blueHarbor] = catalogue.roles;
    // The bullets it rewords stay on offer in the profile's words; one it
    // kept word for word is offered once.
    expect(northwind.lines.map((line) => line.ref)).toEqual([
      "cv:role_00000005:0",
      "cv:role_00000005:1",
      "cv:role_00000005:3",
      "fact:hl_00000006",
      "fact:hl_00000007",
    ]);
    expect(blueHarbor.lines.map((line) => line.ref)).toEqual([
      "cv:role_00000009:0",
      "cv:role_00000009:1",
      "fact:hl_00000010",
    ]);
    expect(form.projects.map((entry) => entry.shown)).toEqual([true, false]);
    expect(form.sections).toEqual(["education", "languages"]);
    expect(form.skillIds).toEqual(content.skillIds);
  });
});

describe("editedContent", () => {
  it("saves the lines kept and added, in the profile's order", () => {
    const { form } = editorStart(profile, from, "modern");
    const edited: CvEditForm = {
      ...form,
      title: "Frontend Lead",
      experience: form.experience.map((entry) =>
        entry.roleId === "role_00000005"
          ? {
              ...entry,
              lines: [
                { ref: "fact:hl_00000007" },
                { ref: "cv:role_00000005:0" },
              ],
            }
          : entry.roleId === "role_00000012"
            ? { ...entry, shown: false }
            : entry,
      ),
      projects: form.projects.map((entry) => ({ ...entry, shown: false })),
      skillIds: ["skill_00000022", "skill_00000021"],
      sections: ["languages"],
    };
    const { content: saved, flags } = editedContent(edited, profile, from);

    expect(flags).toEqual([]);
    expect(saved.headline).toBe("Frontend Lead");
    expect(saved.sections).toEqual(["languages"]);
    expect(saved.skillIds).toEqual(["skill_00000022", "skill_00000021"]);
    expect(saved.projects).toEqual([]);
    expect(saved.experience.map((entry) => entry.roleId)).toEqual([
      "role_00000005",
      "role_00000009",
    ]);
    expect(saved.experience[0].highlights).toEqual([
      {
        id: "role_00000005:0",
        text: profile.experience[0].highlights[1].text,
        sources: ["hl_00000007"],
      },
      {
        id: "role_00000005:1",
        text: "Rebuilt the reporting dashboard in Next.js, cutting page load time from 4.1 s to 1.3 s.",
        sources: ["hl_00000006"],
      },
    ]);
    // An unchanged summary keeps what it cited.
    expect(saved.summary?.sources).toEqual([
      "basics_00000001",
      "role_00000005",
    ]);

    const view = cvView(saved, null, profile);
    expect(view.headline).toBe("Frontend Lead");
    expect(view.education).toEqual([]);
    expect(view.languages).toHaveLength(2);
  });

  it("takes the summary in the owner's words, or none", () => {
    const { form } = editorStart(profile, from, "modern");
    const written = editedContent(
      { ...form, summary: "Frontend lead who ships." },
      profile,
      from,
    );
    expect(written.content.summary).toEqual({
      id: "summary",
      text: "Frontend lead who ships.",
      sources: ["basics_00000001"],
    });
    expect(
      editedContent({ ...form, summary: "" }, profile, from).content.summary,
    ).toBeNull();
  });

  it("refuses a line that isn't on the CV or under that role in the profile", () => {
    const { form } = editorStart(profile, from, "modern");
    const withLine = (roleId: string, ref: string): CvEditForm => ({
      ...form,
      experience: form.experience.map((entry) =>
        entry.roleId === roleId ? { ...entry, lines: [{ ref }] } : entry,
      ),
    });
    // Left out by the claim check.
    expect(() =>
      editedContent(
        withLine("role_00000005", "cv:role_00000005:2"),
        profile,
        from,
      ),
    ).toThrow(CvEditError);
    // Another role's bullet.
    expect(() =>
      editedContent(
        withLine("role_00000005", "fact:hl_00000013"),
        profile,
        from,
      ),
    ).toThrow(CvEditError);
    // A CV line without a CV to edit.
    expect(() =>
      editedContent(
        withLine("role_00000005", "cv:role_00000005:0"),
        profile,
        null,
      ),
    ).toThrow(CvEditError);
  });

  it("refuses a role the profile doesn't have anymore", () => {
    const { form } = editorStart(profile, null, "modern");
    expect(() =>
      editedContent(
        {
          ...form,
          experience: [
            ...form.experience,
            { roleId: "role_gone0000", shown: true, lines: [] },
          ],
        },
        profile,
        null,
      ),
    ).toThrow(CvEditError);
  });
});
