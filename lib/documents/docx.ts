import "server-only";

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
  type IBorderOptions,
  type ParagraphChild,
} from "docx";

import {
  LEGACY_CV_TEMPLATE,
  type CvTemplate,
} from "@/lib/schemas/cv-template";

import type { CvView, LetterView } from "./view";

// The CV and cover letter as Word files, for the employers and forms that ask
// for one. The same view the PDF is drawn from, in the same design's colors,
// laid out the way applicant tracking systems read Word files best: one
// column of paragraphs, real Word headings, real bullets, and dates on a
// right tab rather than in a table. The fonts are ones every copy of Word
// has, so the file looks the same wherever it opens. Building one takes a
// few milliseconds, so it's made when it's downloaded.

type WordTheme = {
  font: string;
  ink: string;
  muted: string;
  accent: string;
  rule: string;
  /** The employer's or school's name. */
  place: string;
  heading: string;
  /** Sizes in points. */
  size: { body: number; name: number; headline: number; heading: number };
  centered: boolean;
  uppercaseHeadings: boolean;
  /** underline: a line under each heading. bar: an accent bar before it. */
  headingStyle: "underline" | "bar" | "plain";
  separator: string;
};

const WORD_THEMES: Record<CvTemplate, WordTheme> = {
  classic: {
    font: "Arial",
    ink: "12161F",
    muted: "535966",
    accent: "224BB2",
    rule: "D6DAE3",
    place: "12161F",
    heading: "224BB2",
    size: { body: 10, name: 22, headline: 12, heading: 10 },
    centered: false,
    uppercaseHeadings: true,
    headingStyle: "underline",
    separator: "|",
  },
  modern: {
    font: "Calibri",
    ink: "0F172A",
    muted: "5B6577",
    accent: "0F766E",
    rule: "E2E8F0",
    place: "0F766E",
    heading: "0F172A",
    size: { body: 10.5, name: 26, headline: 13, heading: 11 },
    centered: false,
    uppercaseHeadings: true,
    headingStyle: "bar",
    separator: "·",
  },
  executive: {
    font: "Georgia",
    ink: "1C1917",
    muted: "57534E",
    accent: "7A2335",
    rule: "D6D3D1",
    place: "1C1917",
    heading: "7A2335",
    size: { body: 10, name: 24, headline: 11, heading: 11 },
    centered: true,
    uppercaseHeadings: true,
    headingStyle: "underline",
    separator: "|",
  },
  minimal: {
    font: "Calibri",
    ink: "111827",
    muted: "6B7280",
    accent: "4338CA",
    rule: "E5E7EB",
    place: "374151",
    heading: "4338CA",
    size: { body: 10.5, name: 28, headline: 13, heading: 12 },
    centered: false,
    uppercaseHeadings: false,
    headingStyle: "plain",
    separator: "·",
  },
};

/** Word measures sizes in half-points and lengths in twentieths of a point. */
const half = (points: number) => Math.round(points * 2);
const twips = (points: number) => Math.round(points * 20);

/** A4, with the PDF's margins. */
const PAGE = { width: 11906, height: 16838, top: 720, bottom: 760, side: 880 };
const CONTENT_WIDTH = PAGE.width - 2 * PAGE.side;

const BULLETS = "cv-bullets";

/** A link as people type it: linkedin.com/in/jane, not the full URL. */
const shortUrl = (url: string) =>
  url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

function header(
  t: WordTheme,
  name: string,
  headline: string | undefined,
  contact: string[],
  links: CvView["links"],
): Paragraph[] {
  const alignment = t.centered ? AlignmentType.CENTER : AlignmentType.LEFT;
  const small = { color: t.muted, size: half(t.size.body - 1) };
  const parts: ParagraphChild[] = [
    ...contact.map((item) => new TextRun({ text: item, ...small })),
    ...links.map(
      (link) =>
        new ExternalHyperlink({
          link: link.url,
          children: [new TextRun({ text: shortUrl(link.url), ...small })],
        }),
    ),
  ];
  const contactRuns = parts.flatMap((part, index) =>
    index === 0
      ? [part]
      : [new TextRun({ text: ` ${t.separator} `, ...small }), part],
  );
  const rule: IBorderOptions = {
    style: t.centered ? BorderStyle.DOUBLE : BorderStyle.SINGLE,
    size: t.headingStyle === "plain" ? 4 : 12,
    color: t.headingStyle === "plain" ? t.rule : t.centered ? t.ink : t.accent,
    space: 8,
  };
  return [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment,
      children: [new TextRun(name)],
    }),
    ...(headline
      ? [
          new Paragraph({
            alignment,
            spacing: { after: twips(3) },
            children: [
              new TextRun({
                text: headline,
                bold: t.headingStyle !== "plain",
                color: t.headingStyle === "plain" ? t.muted : t.accent,
                size: half(t.size.headline),
                allCaps: t.centered,
              }),
            ],
          }),
        ]
      : []),
    new Paragraph({
      alignment,
      border: { bottom: rule },
      spacing: { after: twips(6) },
      children: contactRuns,
    }),
  ];
}

function heading(title: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    keepNext: true,
    children: [new TextRun(title)],
  });
}

function bullets(items: string[]): Paragraph[] {
  return items.map(
    (item) =>
      new Paragraph({
        numbering: { reference: BULLETS, level: 0 },
        spacing: { after: twips(1.5) },
        children: [new TextRun(item)],
      }),
  );
}

function entry(
  t: WordTheme,
  {
    title,
    meta,
    place,
    sub,
    technologies = [],
    highlights,
  }: {
    title: string;
    meta: string;
    place?: string;
    sub: string;
    technologies?: string[];
    highlights: string[];
  },
): Paragraph[] {
  const subline: ParagraphChild[] = [];
  if (place) {
    subline.push(
      new TextRun({ text: place, color: t.place, bold: t.place !== t.ink }),
    );
  }
  if (place && sub) {
    subline.push(new TextRun({ text: ` ${t.separator} `, color: t.muted }));
  }
  if (sub) subline.push(new TextRun({ text: sub, color: t.muted }));
  return [
    new Paragraph({
      keepNext: true,
      spacing: { before: twips(6) },
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
      children: [
        new TextRun({ text: title, bold: true, size: half(t.size.body + 0.5) }),
        ...(meta
          ? [
              new TextRun({
                children: [new Tab(), meta],
                color: t.muted,
                size: half(t.size.body - 1),
              }),
            ]
          : []),
      ],
    }),
    ...(subline.length > 0
      ? [
          new Paragraph({
            keepNext: highlights.length > 0,
            spacing: { after: twips(2) },
            children: subline,
          }),
        ]
      : []),
    ...bullets(highlights),
    ...(technologies.length > 0
      ? [
          new Paragraph({
            spacing: { after: twips(2) },
            children: [
              new TextRun({
                text: "Tech: ",
                bold: true,
                color: t.muted,
                size: half(t.size.body - 1),
              }),
              new TextRun({
                text: technologies.join(", "),
                color: t.muted,
                size: half(t.size.body - 1),
              }),
            ],
          }),
        ]
      : []),
  ];
}

function wordDocument(
  t: WordTheme,
  meta: { title: string; author: string; subject?: string; keywords?: string },
  children: Paragraph[],
): Document {
  const headingBorder: { bottom?: IBorderOptions; left?: IBorderOptions } =
    t.headingStyle === "underline"
      ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: t.rule, space: 2 } }
      : t.headingStyle === "bar"
        ? {
            left: {
              style: BorderStyle.SINGLE,
              size: 24,
              color: t.accent,
              space: 6,
            },
          }
        : {};
  return new Document({
    title: meta.title,
    creator: meta.author,
    subject: meta.subject,
    keywords: meta.keywords,
    lastModifiedBy: "Job Agent",
    styles: {
      default: {
        document: {
          run: { font: t.font, size: half(t.size.body), color: t.ink },
          paragraph: { spacing: { after: 0, line: 264 } },
        },
        title: {
          run: {
            font: t.font,
            size: half(t.size.name),
            bold: true,
            color: t.ink,
          },
          paragraph: { spacing: { after: twips(2) } },
        },
        heading1: {
          run: {
            font: t.font,
            size: half(t.size.heading),
            bold: true,
            color: t.heading,
            allCaps: t.uppercaseHeadings,
          },
          paragraph: {
            spacing: { before: twips(12), after: twips(5) },
            border: headingBorder,
            keepNext: true,
          },
        },
        hyperlink: { run: { color: t.muted, underline: {} } },
      },
    },
    numbering: {
      config: [
        {
          reference: BULLETS,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: twips(14), hanging: twips(10) } },
                run: { color: t.accent },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE.width, height: PAGE.height },
            margin: {
              top: PAGE.top,
              bottom: PAGE.bottom,
              left: PAGE.side,
              right: PAGE.side,
            },
          },
        },
        children,
      },
    ],
  });
}

async function pack(document: Document): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await Packer.toBuffer(document));
}

/** The CV as a Word file, in the design's fonts and colors. */
export async function renderCvDocx(
  cv: CvView,
  template: CvTemplate = LEGACY_CV_TEMPLATE,
): Promise<Uint8Array<ArrayBuffer>> {
  const t = WORD_THEMES[template];
  const children: Paragraph[] = header(
    t,
    cv.name,
    cv.headline,
    cv.contact,
    cv.links,
  );
  if (cv.summary) {
    children.push(heading("Summary"), new Paragraph(cv.summary));
  }
  if (cv.skills.length > 0) {
    children.push(heading("Skills"));
    if (cv.skillGroups.length <= 1) {
      children.push(new Paragraph(cv.skills.join(", ")));
    } else {
      for (const group of cv.skillGroups) {
        children.push(
          new Paragraph({
            spacing: { after: twips(2) },
            children: [
              new TextRun({ text: `${group.category}: `, bold: true }),
              new TextRun(group.names.join(", ")),
            ],
          }),
        );
      }
    }
  }
  if (cv.experience.length > 0) {
    children.push(heading("Experience"));
    for (const role of cv.experience) {
      children.push(
        ...entry(t, {
          title: role.title,
          meta: role.dates,
          place: role.company,
          sub: role.location,
          technologies: role.technologies,
          highlights: role.highlights,
        }),
      );
    }
  }
  if (cv.projects.length > 0) {
    children.push(heading("Projects"));
    for (const project of cv.projects) {
      children.push(
        ...entry(t, {
          title: project.role
            ? `${project.name}, ${project.role}`
            : project.name,
          meta: project.dates,
          sub: project.url ? shortUrl(project.url) : "",
          highlights: project.highlights,
        }),
      );
    }
  }
  if (cv.education.length > 0) {
    children.push(heading("Education"));
    for (const item of cv.education) {
      children.push(
        ...entry(t, {
          title: item.title || item.institution,
          meta: item.dates,
          place: item.title ? item.institution : undefined,
          sub: item.details,
          highlights: [],
        }),
      );
    }
  }
  if (cv.certifications.length > 0) {
    children.push(heading("Certifications"), ...bullets(cv.certifications));
  }
  if (cv.languages.length > 0) {
    children.push(heading("Languages"), new Paragraph(cv.languages.join(", ")));
  }
  return pack(
    wordDocument(
      t,
      {
        title: `${cv.name} – CV`,
        author: cv.name,
        subject: cv.headline || undefined,
        keywords: cv.skills.join(", ") || undefined,
      },
      children,
    ),
  );
}

/** The cover letter as a Word file, matching the CV sent with it. */
export async function renderLetterDocx(
  letter: LetterView,
  date: string,
  template: CvTemplate = LEGACY_CV_TEMPLATE,
): Promise<Uint8Array<ArrayBuffer>> {
  const t = WORD_THEMES[template];
  const body = (text: string, after = 10) =>
    new Paragraph({
      spacing: { after: twips(after), line: 288 },
      children: [new TextRun({ text, size: half(t.size.body + 1) })],
    });
  return pack(
    wordDocument(t, { title: `${letter.name} – Cover letter`, author: letter.name }, [
      ...header(t, letter.name, undefined, letter.contact, letter.links),
      new Paragraph({
        spacing: { before: twips(18), after: twips(14) },
        children: [
          new TextRun({
            text: date,
            color: t.muted,
            size: half(t.size.body + 1),
          }),
        ],
      }),
      body(letter.greeting),
      ...letter.paragraphs.map((paragraph) => body(paragraph)),
      body(letter.closing, 0),
      body(letter.name, 0),
    ]),
  );
}
