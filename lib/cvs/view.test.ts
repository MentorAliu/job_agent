import { describe, expect, it } from "vitest";

import { masterProfileSchema, type MasterProfile } from "@/lib/schemas/profile";
import { tailorOutputSchema, type CvContent } from "@/lib/schemas/tailor";
import { toDocuments } from "@/lib/tailor/citations";
import { factIndex, profileFacts } from "@/lib/tailor/facts";
import profileJson from "@/test/fixtures/profile.json";
import tailored from "@/test/fixtures/claude/tailor-response.json";

import { builtCvFilename, builtCvView } from "./view";

const profile: MasterProfile = masterProfileSchema.parse(profileJson);
const [cv] = toDocuments(
  tailorOutputSchema.parse(JSON.parse(tailored.body.content[0].text)),
  ["cv"],
  profile,
  factIndex(profileFacts(profile, null)),
);

describe("builtCvView", () => {
  it("shows the target title and only the sections asked for", () => {
    const view = builtCvView(cv.content as CvContent, null, profile, {
      targetTitle: "Frontend Lead",
      sections: ["certifications"],
    });
    expect(view.headline).toBe("Frontend Lead");
    expect(view.projects).toEqual([]);
    expect(view.education).toEqual([]);
    expect(view.languages).toEqual([]);
    expect(view.certifications).toHaveLength(1);
    expect(view.experience).toHaveLength(profile.experience.length);
  });
});

describe("builtCvFilename", () => {
  it("names the PDF after the owner and the job title, safe for any disk", () => {
    expect(builtCvFilename("Jordan Sample", "Senior Frontend Engineer")).toBe(
      "Jordan Sample - CV - Senior Frontend Engineer.pdf",
    );
    expect(builtCvFilename("Jordan Sample", "Frontend / UI: Lead?")).toBe(
      "Jordan Sample - CV - Frontend UI Lead.pdf",
    );
  });
});
