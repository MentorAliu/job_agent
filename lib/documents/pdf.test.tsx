import { describe, expect, it } from "vitest";

import { masterProfileSchema, type MasterProfile } from "@/lib/schemas/profile";
import {
  tailorOutputSchema,
  type CoverLetterContent,
  type CvContent,
} from "@/lib/schemas/tailor";
import { toDocuments } from "@/lib/tailor/citations";
import { factIndex, profileFacts } from "@/lib/tailor/facts";
import profileJson from "@/test/fixtures/profile.json";
import tailored from "@/test/fixtures/claude/tailor-response.json";

import { pdfPageCount, renderCvPdf, renderLetterPdf } from "./pdf";
import { cvView, letterView } from "./view";

const profile: MasterProfile = masterProfileSchema.parse(profileJson);
const [cv, letter] = toDocuments(
  tailorOutputSchema.parse(JSON.parse(tailored.body.content[0].text)),
  ["cv", "cover_letter"],
  profile,
  factIndex(profileFacts(profile, null)),
);

const header = (bytes: Uint8Array) =>
  new TextDecoder().decode(bytes.subarray(0, 5));

describe("PDF rendering (step 10)", () => {
  it("draws the tailored CV as a PDF", async () => {
    const bytes = await renderCvPdf(
      cvView(
        cv.content as CvContent,
        { ...cv, checkedAt: null, checkError: null },
        profile,
      ),
    );
    expect(header(bytes)).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
    // A short career fits on one page.
    expect(pdfPageCount(bytes)).toBe(1);
  });

  it("runs onto a second page when the CV is long", async () => {
    const content = cv.content as CvContent;
    const long: CvContent = {
      ...content,
      experience: content.experience.map((role) => ({
        ...role,
        highlights: Array.from({ length: 8 }, (_, index) => ({
          id: `${role.roleId}:${index}`,
          text: "Rebuilt the reporting dashboard in Next.js, cutting page load time from 4.1 s to 1.3 s for 4 product teams.",
          sources: [role.roleId],
        })),
      })),
    };
    const bytes = await renderCvPdf(cvView(long, null, profile));
    expect(pdfPageCount(bytes)).toBe(2);
  });

  it("draws the cover letter as a PDF", async () => {
    const bytes = await renderLetterPdf(
      letterView(
        letter.content as CoverLetterContent,
        null,
        profile,
        "Northwind Labs",
      ),
      "18 October 2026",
    );
    expect(header(bytes)).toBe("%PDF-");
    expect(pdfPageCount(bytes)).toBe(1);
  });
});
