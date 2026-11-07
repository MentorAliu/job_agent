import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CV_TEMPLATES } from "@/lib/schemas/cv-template";

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
import { cvView, letterView, type CvView } from "./view";

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

/** The text a PDF reader (and an applicant tracking system) gets out of it. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const scope = globalThis as { pdfjsWorker?: unknown };
  scope.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = lib.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    verbosity: 0,
  });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const { items } = await (await pdf.getPage(number)).getTextContent();
    pages.push(
      items
        .map((item) =>
          "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "",
        )
        .join(""),
    );
  }
  await task.destroy();
  return pages.join("\n").replace(/[ \t]+/g, " ");
}

/** Every section a CV can have, to draw each design with. */
const full: CvView = {
  ...cvView(
    cv.content as CvContent,
    { ...cv, checkedAt: null, checkError: null },
    profile,
  ),
  headline: "Senior Frontend Engineer",
};

// To refresh the design pictures on the CV builder's form, run this file
// with CV_DESIGN_PDFS set to a folder, then turn page 1 of each PDF into
// public/cv-designs/<design>.png (pdftoppm -png -singlefile -scale-to-x 480).
const pictures = process.env.CV_DESIGN_PDFS;

describe.each(CV_TEMPLATES)("the %s design", (template) => {
  it("reads in order, as one column of plain text", async () => {
    const bytes = await renderCvPdf(full, template);
    if (pictures) {
      mkdirSync(pictures, { recursive: true });
      writeFileSync(path.join(pictures, `${template}.pdf`), bytes);
    }
    const text = await pdfText(bytes);
    // Lines run on: a line break reads as a space. Some designs set the
    // title or headings in capitals, which a reader takes as they're drawn.
    const flat = text.replace(/\s+/g, " ").toLowerCase();
    const order = [
      "Jordan Sample",
      "Senior Frontend Engineer",
      "jordan.sample@example.com",
      "github.com/jordansample",
      /summary/i,
      full.summary ?? "",
      /skills/i,
      /experience/i,
      full.experience[0].title,
      full.experience[0].company,
      full.experience[0].highlights[0],
      full.experience[1].title,
      /education/i,
      full.education[0].institution,
    ];
    let from = 0;
    for (const expected of order) {
      const at =
        typeof expected === "string"
          ? flat.indexOf(expected.toLowerCase(), from)
          : flat.slice(from).search(expected) + from;
      expect(at, `"${String(expected)}" after offset ${from}`).toBeGreaterThanOrEqual(
        from,
      );
      from = at;
    }
    // No letters joined into one glyph, and no hyphen added where the
    // contact details wrap.
    expect(text).toContain("Certified");
    expect(text).not.toMatch(/[|·]-/);
  });

  it("fits a short career on one page, and draws the letter", async () => {
    const bytes = await renderCvPdf(
      cvView(
        cv.content as CvContent,
        { ...cv, checkedAt: null, checkError: null },
        profile,
      ),
      template,
    );
    if (pictures) {
      writeFileSync(path.join(pictures, `${template}-short.pdf`), bytes);
    }
    expect(pdfPageCount(bytes)).toBe(1);
    const letterBytes = await renderLetterPdf(
      letterView(
        letter.content as CoverLetterContent,
        null,
        profile,
        "Northwind Labs",
      ),
      "18 October 2026",
      template,
    );
    expect(pdfPageCount(letterBytes)).toBe(1);
    expect(await pdfText(letterBytes)).toContain("Dear Northwind Labs");
  });
});
