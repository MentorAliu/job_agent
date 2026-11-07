import "server-only";

import path from "node:path";

import {
  Document,
  Font,
  Link,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import {
  LEGACY_CV_TEMPLATE,
  type CvTemplate,
} from "@/lib/schemas/cv-template";

import type { CvView, LetterView } from "./view";

// Step 10: the tailored CV and cover letter as PDFs, drawn in plain Node with
// @react-pdf/renderer, so neither Docker nor Vercel needs a browser. Built
// CVs use the same code.
//
// Every design follows what applicant tracking systems read best: one
// column, real text in reading order, standard section names, contact
// details in the page itself rather than a header, and dates in one format.
// Shapes such as the header band and the heading bars are drawn, not typed,
// so they never reach the text an ATS reads. The designs differ only in type,
// color and spacing, which are for the people who read the CV after the ATS.

// Words wrap whole; the default hyphenation splits names and technologies.
Font.registerHyphenationCallback((word) => [word]);

// The fonts live beside this file (next.config.ts traces them into the
// Inngest function), cut to Latin, Greek and Cyrillic with ligatures taken
// out, so "fi" is read as two letters. All three are under the SIL Open Font
// License; see the OFL files there.
const FONT_DIR = path.join(process.cwd(), "lib", "documents", "fonts");

function registerFamily(family: string, files: [weight: number, file: string][]) {
  Font.register({
    family,
    fonts: files.map(([fontWeight, file]) => ({
      src: path.join(FONT_DIR, file),
      fontWeight,
    })),
  });
}

registerFamily("Inter", [
  [400, "Inter-Regular.ttf"],
  [600, "Inter-SemiBold.ttf"],
  [700, "Inter-Bold.ttf"],
]);
registerFamily("Source Serif", [
  [400, "SourceSerif4-Regular.ttf"],
  [600, "SourceSerif4-SemiBold.ttf"],
  [700, "SourceSerif4-Bold.ttf"],
]);
registerFamily("DM Sans", [
  [400, "DMSans-Regular.ttf"],
  [500, "DMSans-Medium.ttf"],
  [700, "DMSans-Bold.ttf"],
]);

// ---------------------------------------------------------------------------
// The designs
// ---------------------------------------------------------------------------

type Theme = {
  font: string;
  /** Role titles, skill categories and labels. */
  strong: number;
  /** Section headings. */
  headingWeight: number;
  nameWeight: number;
  size: {
    body: number;
    name: number;
    headline: number;
    heading: number;
    title: number;
    meta: number;
  };
  lineHeight: number;
  color: {
    ink: string;
    muted: string;
    accent: string;
    rule: string;
    /** The employer's or school's name. */
    place: string;
    heading: string;
    /** The bullet marks. */
    mark: string;
  };
  /**
   * rule: name, title and contact over an accent line. band: the same in
   * white on a dark band across the top. centered: centered, over a double
   * line. plain: left, with space and a hairline.
   */
  header: "rule" | "band" | "centered" | "plain";
  band?: { background: string; name: string; headline: string; contact: string };
  /** underline: a hairline under the heading. bar: an accent bar before it and a hairline after. plain: neither. */
  heading: "underline" | "bar" | "plain";
  uppercaseHeadings: boolean;
  /** Between contact details, and between an employer and its place. */
  separator: string;
  /** Space above each section. */
  sectionGap: number;
};

const PAGE = { top: 36, bottom: 42, side: 44 };

const THEMES: Record<CvTemplate, Theme> = {
  // The first design: Helvetica, built into every PDF reader, with cobalt
  // headings over hairlines.
  classic: {
    font: "Helvetica",
    strong: 700,
    headingWeight: 700,
    nameWeight: 700,
    size: {
      body: 9.75,
      name: 22,
      headline: 11.5,
      heading: 9.5,
      title: 10.25,
      meta: 8.75,
    },
    lineHeight: 1.35,
    color: {
      ink: "#12161f",
      muted: "#535966",
      accent: "#224bb2",
      rule: "#d6dae3",
      place: "#12161f",
      heading: "#224bb2",
      mark: "#224bb2",
    },
    header: "rule",
    heading: "underline",
    uppercaseHeadings: true,
    separator: "|",
    sectionGap: 11,
  },
  // Inter under a deep slate band, with teal accents.
  modern: {
    font: "Inter",
    strong: 600,
    headingWeight: 700,
    nameWeight: 700,
    size: {
      body: 9.25,
      name: 24,
      headline: 11.5,
      heading: 9.5,
      title: 10,
      meta: 8.5,
    },
    lineHeight: 1.4,
    color: {
      ink: "#0f172a",
      muted: "#5b6577",
      accent: "#0f766e",
      rule: "#e2e8f0",
      place: "#0f766e",
      heading: "#0f172a",
      mark: "#0f766e",
    },
    header: "band",
    band: {
      background: "#0f172a",
      name: "#ffffff",
      headline: "#5eead4",
      contact: "#cbd5e1",
    },
    heading: "bar",
    uppercaseHeadings: true,
    separator: "·",
    sectionGap: 13,
  },
  // Source Serif, centered, in ink and burgundy: a quiet, formal look.
  executive: {
    font: "Source Serif",
    strong: 600,
    headingWeight: 700,
    nameWeight: 700,
    size: {
      body: 9.5,
      name: 24,
      headline: 10.5,
      heading: 10.25,
      title: 10.25,
      meta: 8.75,
    },
    lineHeight: 1.32,
    color: {
      ink: "#1c1917",
      muted: "#57534e",
      accent: "#7a2335",
      rule: "#d6d3d1",
      place: "#1c1917",
      heading: "#7a2335",
      mark: "#7a2335",
    },
    header: "centered",
    heading: "underline",
    uppercaseHeadings: true,
    separator: "|",
    sectionGap: 11,
  },
  // DM Sans in near-black with indigo headings, lots of air and no lines.
  minimal: {
    font: "DM Sans",
    strong: 700,
    headingWeight: 700,
    nameWeight: 500,
    size: {
      body: 9.25,
      name: 25,
      headline: 11.5,
      heading: 10.75,
      title: 10,
      meta: 8.5,
    },
    lineHeight: 1.38,
    color: {
      ink: "#111827",
      muted: "#6b7280",
      accent: "#4338ca",
      rule: "#e5e7eb",
      place: "#374151",
      heading: "#4338ca",
      mark: "#9ca3af",
    },
    header: "plain",
    heading: "plain",
    uppercaseHeadings: false,
    separator: "·",
    sectionGap: 12,
  },
};

function makeStyles(t: Theme) {
  return StyleSheet.create({
    page: {
      paddingTop: PAGE.top,
      paddingBottom: PAGE.bottom,
      paddingHorizontal: PAGE.side,
      fontFamily: t.font,
      fontSize: t.size.body,
      color: t.color.ink,
    },
    // On the content, not the page: with a line height on the page, the
    // page numbers never draw. The font size turns it into points, which
    // the text inside takes on.
    body: { fontSize: t.size.body, lineHeight: t.lineHeight },
    strong: { fontWeight: t.strong },

    // Header
    name: {
      fontSize: t.size.name,
      fontWeight: t.nameWeight,
      lineHeight: 1.15,
      color: t.header === "band" ? t.band?.name : t.color.ink,
      ...(t.header === "rule" ? { letterSpacing: -0.2 } : {}),
    },
    headline: {
      fontSize: t.size.headline,
      fontWeight: t.header === "plain" ? 400 : t.strong,
      color:
        t.header === "band"
          ? t.band?.headline
          : t.header === "plain"
            ? t.color.muted
            : t.color.accent,
      marginTop: t.header === "plain" ? 2 : 3,
      ...(t.header === "centered" ? { textTransform: "uppercase" } : {}),
    },
    contact: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: t.header === "centered" ? "center" : "flex-start",
      fontSize: t.size.meta,
      color: t.header === "band" ? t.band?.contact : t.color.muted,
      marginTop: t.header === "plain" ? 6 : 5,
    },
    contactItem: { marginRight: t.size.meta * 0.3 },
    link: {
      color: t.header === "band" ? t.band?.contact : t.color.muted,
      textDecoration: "none",
    },
    headerRule: { marginTop: 10, height: 1.5, backgroundColor: t.color.accent },
    band: {
      marginTop: -PAGE.top,
      marginHorizontal: -PAGE.side,
      paddingHorizontal: PAGE.side,
      paddingTop: 30,
      paddingBottom: 20,
      backgroundColor: t.band?.background,
    },
    centered: { alignItems: "center", textAlign: "center" },
    doubleRuleThick: {
      marginTop: 10,
      height: 1.25,
      backgroundColor: t.color.ink,
      alignSelf: "stretch",
    },
    doubleRuleThin: {
      marginTop: 1.75,
      height: 0.5,
      backgroundColor: t.color.ink,
      alignSelf: "stretch",
    },
    plainRule: { marginTop: 12, height: 0.75, backgroundColor: t.color.rule },

    // Sections
    section: { marginTop: t.sectionGap },
    heading: {
      fontSize: t.size.heading,
      fontWeight: t.headingWeight,
      color: t.color.heading,
      ...(t.uppercaseHeadings ? { textTransform: "uppercase" } : {}),
      ...(t.heading === "underline"
        ? {
            borderBottomWidth: 0.6,
            borderBottomColor: t.color.rule,
            paddingBottom: 2,
            marginBottom: 5,
          }
        : t.heading === "plain"
          ? { marginBottom: 4 }
          : {}),
    },
    headingRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 6,
    },
    headingBar: {
      width: 3,
      height: t.size.heading + 1.5,
      backgroundColor: t.color.accent,
      marginRight: 6,
    },
    headingLine: {
      flexGrow: 1,
      height: 0.75,
      backgroundColor: t.color.rule,
      marginLeft: 8,
    },

    // Entries
    entry: { marginBottom: t.header === "plain" ? 8 : 7 },
    entryHead: { flexDirection: "row", justifyContent: "space-between" },
    entryTitle: {
      fontWeight: t.strong,
      fontSize: t.size.title,
      flexShrink: 1,
      color: t.color.ink,
    },
    entryMeta: {
      color: t.color.muted,
      fontSize: t.size.meta,
      marginLeft: 10,
      paddingTop: 1,
    },
    entrySub: { color: t.color.muted, fontSize: t.size.meta + 0.25 },
    entryPlace: {
      color: t.color.place,
      ...(t.color.place === t.color.ink ? {} : { fontWeight: t.strong }),
    },
    tech: { color: t.color.muted, fontSize: t.size.meta - 0.25, marginTop: 2 },
    bullet: { flexDirection: "row", marginTop: 2 },
    bulletMark: { width: 11, color: t.color.mark },
    bulletText: { flex: 1 },
    skillLine: { marginBottom: 2 },
    paragraph: { marginBottom: 10 },
    footer: {
      position: "absolute",
      bottom: 20,
      left: PAGE.side,
      right: PAGE.side,
      fontSize: 8,
      color: t.color.muted,
      textAlign: "right",
    },
  });
}

type Styles = ReturnType<typeof makeStyles>;
type Look = { theme: Theme; s: Styles };

const looks = new Map<CvTemplate, Look>();

function lookFor(template: CvTemplate): Look {
  let look = looks.get(template);
  if (!look) {
    const theme = THEMES[template];
    look = { theme, s: makeStyles(theme) };
    looks.set(template, look);
  }
  return look;
}

// ---------------------------------------------------------------------------
// The parts
// ---------------------------------------------------------------------------

/** A link as people type it: linkedin.com/in/jane, not the full URL. */
const shortUrl = (url: string) =>
  url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

function Contact({
  look,
  contact,
  links,
}: {
  look: Look;
  contact: string[];
  links: CvView["links"];
}) {
  const { s, theme } = look;
  const parts = [
    ...contact.map((item) => ({ key: item, node: item })),
    ...links.map((link) => ({
      key: link.url,
      node: (
        <Link src={link.url} style={s.link}>
          {shortUrl(link.url)}
        </Link>
      ),
    })),
  ];
  if (parts.length === 0) return null;
  // Each detail keeps its separator and never breaks inside: where details
  // run onto a second line, a line break between two pieces of text would
  // otherwise get a hyphen. The space after a separator is a margin, since a
  // text box drops the spaces it ends with.
  return (
    <View style={s.contact}>
      {parts.map((part, index) => {
        const last = index === parts.length - 1;
        return (
          <View
            key={part.key}
            wrap={false}
            style={last ? undefined : s.contactItem}
          >
            <Text>
              {part.node}
              {last ? null : ` ${theme.separator}`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function Header({
  look,
  name,
  headline,
  contact,
  links,
}: {
  look: Look;
  name: string;
  headline?: string;
  contact: string[];
  links: CvView["links"];
}) {
  const { s, theme } = look;
  const lines = (
    <>
      <Text style={s.name}>{name}</Text>
      {headline ? <Text style={s.headline}>{headline}</Text> : null}
      <Contact look={look} contact={contact} links={links} />
    </>
  );
  switch (theme.header) {
    case "band":
      return <View style={s.band}>{lines}</View>;
    case "centered":
      return (
        <View style={s.centered}>
          {lines}
          <View style={s.doubleRuleThick} />
          <View style={s.doubleRuleThin} />
        </View>
      );
    case "plain":
      return (
        <View>
          {lines}
          <View style={s.plainRule} />
        </View>
      );
    case "rule":
      return (
        <View>
          {lines}
          <View style={s.headerRule} />
        </View>
      );
  }
}

function Section({
  look,
  title,
  keep = false,
  children,
}: {
  look: Look;
  title: string;
  /** A short section moves to the next page whole rather than split. */
  keep?: boolean;
  children: React.ReactNode;
}) {
  const { s, theme } = look;
  return (
    <View style={s.section} wrap={!keep}>
      {/* A heading never sits alone at the foot of a page. */}
      {theme.heading === "bar" ? (
        <View style={s.headingRow} minPresenceAhead={36} wrap={false}>
          <View style={s.headingBar} />
          <Text style={s.heading}>{title}</Text>
          <View style={s.headingLine} />
        </View>
      ) : (
        <Text style={s.heading} minPresenceAhead={36}>
          {title}
        </Text>
      )}
      {children}
    </View>
  );
}

function Bullets({ look, items }: { look: Look; items: string[] }) {
  const { s } = look;
  return items.map((item, index) => (
    <View key={index} style={s.bullet} wrap={false}>
      <Text style={s.bulletMark}>•</Text>
      <Text style={s.bulletText}>{item}</Text>
    </View>
  ));
}

function Entry({
  look,
  title,
  meta,
  place,
  sub,
  technologies = [],
  highlights,
}: {
  look: Look;
  title: string;
  meta: string;
  /** The employer or school, on the line under the title. */
  place?: string;
  sub: string;
  technologies?: string[];
  highlights: string[];
}) {
  const { s, theme } = look;
  const subline = [place, sub].filter(Boolean);
  return (
    <View style={s.entry}>
      <View wrap={false} minPresenceAhead={24}>
        <View style={s.entryHead}>
          <Text style={s.entryTitle}>{title}</Text>
          {meta ? <Text style={s.entryMeta}>{meta}</Text> : null}
        </View>
        {subline.length > 0 ? (
          <Text style={s.entrySub}>
            {place ? <Text style={s.entryPlace}>{place}</Text> : null}
            {place && sub ? ` ${theme.separator} ` : null}
            {sub}
          </Text>
        ) : null}
      </View>
      <Bullets look={look} items={highlights} />
      {technologies.length > 0 ? (
        <Text style={s.tech}>
          <Text style={s.strong}>Tech: </Text>
          {technologies.join(", ")}
        </Text>
      ) : null}
    </View>
  );
}

function Skills({ look, cv }: { look: Look; cv: CvView }) {
  const { s } = look;
  // One category reads better as a plain line.
  if (cv.skillGroups.length <= 1) return <Text>{cv.skills.join(", ")}</Text>;
  return cv.skillGroups.map((group) => (
    <Text key={group.category} style={s.skillLine}>
      <Text style={s.strong}>{group.category}: </Text>
      {group.names.join(", ")}
    </Text>
  ));
}

// ---------------------------------------------------------------------------
// The documents
// ---------------------------------------------------------------------------

export function CvDocument({
  cv,
  template = LEGACY_CV_TEMPLATE,
}: {
  cv: CvView;
  template?: CvTemplate;
}) {
  const look = lookFor(template);
  const { s } = look;
  return (
    <Document
      title={`${cv.name} – CV`}
      author={cv.name}
      subject={cv.headline || undefined}
      keywords={cv.skills.join(", ") || undefined}
      creator="Job Agent"
      producer="Job Agent"
      language="en"
    >
      <Page size="A4" style={s.page}>
        <View style={s.body}>
          <Header
            look={look}
            name={cv.name}
            headline={cv.headline}
            contact={cv.contact}
            links={cv.links}
          />

          {cv.summary ? (
            <Section look={look} title="Summary" keep>
              <Text>{cv.summary}</Text>
            </Section>
          ) : null}

          {cv.skills.length > 0 ? (
            <Section look={look} title="Skills" keep>
              <Skills look={look} cv={cv} />
            </Section>
          ) : null}

          {cv.experience.length > 0 ? (
            <Section look={look} title="Experience">
              {cv.experience.map((role) => (
                <Entry
                  key={role.id}
                  look={look}
                  title={role.title}
                  meta={role.dates}
                  place={role.company}
                  sub={role.location}
                  technologies={role.technologies}
                  highlights={role.highlights}
                />
              ))}
            </Section>
          ) : null}

          {cv.projects.length > 0 ? (
            <Section look={look} title="Projects">
              {cv.projects.map((project) => (
                <Entry
                  key={project.id}
                  look={look}
                  title={
                    project.role
                      ? `${project.name}, ${project.role}`
                      : project.name
                  }
                  meta={project.dates}
                  sub={project.url ? shortUrl(project.url) : ""}
                  highlights={project.highlights}
                />
              ))}
            </Section>
          ) : null}

          {cv.education.length > 0 ? (
            <Section look={look} title="Education" keep>
              {cv.education.map((entry) => (
                <Entry
                  key={entry.id}
                  look={look}
                  title={entry.title || entry.institution}
                  meta={entry.dates}
                  place={entry.title ? entry.institution : undefined}
                  sub={entry.details}
                  highlights={[]}
                />
              ))}
            </Section>
          ) : null}

          {cv.certifications.length > 0 ? (
            <Section look={look} title="Certifications" keep>
              <Bullets look={look} items={cv.certifications} />
            </Section>
          ) : null}

          {cv.languages.length > 0 ? (
            <Section look={look} title="Languages" keep>
              <Text>{cv.languages.join(", ")}</Text>
            </Section>
          ) : null}
        </View>

        <Text
          fixed
          style={s.footer}
          // A blank first: the text box keeps a line's height until the
          // page count is known.
          render={({ pageNumber, totalPages }) =>
            totalPages > 1
              ? `${cv.name} | Page ${pageNumber} of ${totalPages}`
              : " "
          }
        />
      </Page>
    </Document>
  );
}

export function LetterDocument({
  letter,
  date,
  template = LEGACY_CV_TEMPLATE,
}: {
  letter: LetterView;
  /** The date line, already formatted. */
  date: string;
  /** The letter matches the CV sent with it. */
  template?: CvTemplate;
}) {
  const look = lookFor(template);
  const { s, theme } = look;
  const size = theme.size.body + 1.25;
  return (
    <Document
      title={`${letter.name} – Cover letter`}
      author={letter.name}
      creator="Job Agent"
    >
      <Page size="A4" style={s.page}>
        <View style={{ fontSize: size, lineHeight: 1.45 }}>
          <Header
            look={look}
            name={letter.name}
            contact={letter.contact}
            links={letter.links}
          />
          <Text
            style={{ marginTop: 22, marginBottom: 16, color: theme.color.muted }}
          >
            {date}
          </Text>
          <Text style={s.paragraph}>{letter.greeting}</Text>
          {letter.paragraphs.map((paragraph, index) => (
            <Text key={index} style={s.paragraph}>
              {paragraph}
            </Text>
          ))}
          <Text style={{ marginTop: 6 }}>{letter.closing}</Text>
          <Text>{letter.name}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderCvPdf(
  cv: CvView,
  template: CvTemplate = LEGACY_CV_TEMPLATE,
): Promise<Uint8Array> {
  return new Uint8Array(
    await renderToBuffer(<CvDocument cv={cv} template={template} />),
  );
}

/** How many pages a PDF drawn here has: one page object per page. */
export function pdfPageCount(bytes: Uint8Array): number {
  const text = new TextDecoder("latin1").decode(bytes);
  return text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
}

export async function renderLetterPdf(
  letter: LetterView,
  date: string,
  template: CvTemplate = LEGACY_CV_TEMPLATE,
): Promise<Uint8Array> {
  return new Uint8Array(
    await renderToBuffer(
      <LetterDocument letter={letter} date={date} template={template} />,
    ),
  );
}
