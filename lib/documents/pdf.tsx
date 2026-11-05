import "server-only";

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

import type { CvView, LetterView } from "./view";

// Step 10: the tailored CV and cover letter as PDFs, drawn in plain Node with
// @react-pdf/renderer, so neither Docker nor Vercel needs a browser. Built
// CVs use the same template. The built-in Helvetica keeps the files small and
// needs no font download.
//
// The CV follows what applicant tracking systems read best: one column, real
// text in reading order, standard section names, contact details in the
// page itself rather than a header, and dates in one format. The accent
// color and the spacing are for the people who read it after the ATS.

// Words wrap whole; the default hyphenation splits names and technologies.
Font.registerHyphenationCallback((word) => [word]);

const INK = "#12161f";
const MUTED = "#535966";
const ACCENT = "#224bb2";
const RULE = "#d6dae3";

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 42,
    paddingHorizontal: 44,
    fontFamily: "Helvetica",
    fontSize: 9.75,
    color: INK,
  },
  // On the content, not the page: with a line height on the page, the page
  // numbers never draw. The font size turns it into points, which the text
  // inside takes on.
  body: { fontSize: 9.75, lineHeight: 1.35 },
  name: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.15,
    letterSpacing: -0.2,
  },
  headline: {
    fontSize: 11.5,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
    marginTop: 3,
  },
  contact: { fontSize: 8.75, color: MUTED, marginTop: 5 },
  link: { color: MUTED, textDecoration: "none" },
  headerRule: { marginTop: 10, height: 1.5, backgroundColor: ACCENT },
  section: { marginTop: 11 },
  heading: {
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    color: ACCENT,
    borderBottomWidth: 0.6,
    borderBottomColor: RULE,
    paddingBottom: 2,
    marginBottom: 5,
  },
  entry: { marginBottom: 7 },
  entryHead: { flexDirection: "row", justifyContent: "space-between" },
  entryTitle: { fontFamily: "Helvetica-Bold", fontSize: 10.25, flexShrink: 1 },
  entryMeta: { color: MUTED, fontSize: 8.75, marginLeft: 10, paddingTop: 1 },
  entrySub: { color: MUTED, fontSize: 9 },
  entryPlace: { color: INK },
  tech: { color: MUTED, fontSize: 8.5, marginTop: 2 },
  bullet: { flexDirection: "row", marginTop: 2 },
  bulletMark: { width: 11, color: ACCENT },
  bulletText: { flex: 1 },
  skillLine: { marginBottom: 2 },
  label: { fontFamily: "Helvetica-Bold" },
  paragraph: { marginBottom: 10 },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 44,
    right: 44,
    fontSize: 8,
    color: MUTED,
    textAlign: "right",
  },
});

/** A link as people type it: linkedin.com/in/jane, not the full URL. */
const shortUrl = (url: string) =>
  url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

function Contact({
  contact,
  links,
}: {
  contact: string[];
  links: CvView["links"];
}) {
  const parts = [
    ...contact.map((item) => ({ key: item, node: <Text>{item}</Text> })),
    ...links.map((link) => ({
      key: link.url,
      node: (
        <Link src={link.url} style={styles.link}>
          {shortUrl(link.url)}
        </Link>
      ),
    })),
  ];
  if (parts.length === 0) return null;
  return (
    <Text style={styles.contact}>
      {parts.flatMap((part, index) =>
        index === 0
          ? [<Text key={part.key}>{part.node}</Text>]
          : [
              <Text key={`${part.key}-sep`}> | </Text>,
              <Text key={part.key}>{part.node}</Text>,
            ],
      )}
    </Text>
  );
}

function Header({
  name,
  headline,
  contact,
  links,
}: {
  name: string;
  headline?: string;
  contact: string[];
  links: CvView["links"];
}) {
  return (
    <View>
      <Text style={styles.name}>{name}</Text>
      {headline ? <Text style={styles.headline}>{headline}</Text> : null}
      <Contact contact={contact} links={links} />
      <View style={styles.headerRule} />
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      {/* A heading never sits alone at the foot of a page. */}
      <Text style={styles.heading} minPresenceAhead={36}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Bullets({ items }: { items: string[] }) {
  return items.map((item, index) => (
    <View key={index} style={styles.bullet} wrap={false}>
      <Text style={styles.bulletMark}>•</Text>
      <Text style={styles.bulletText}>{item}</Text>
    </View>
  ));
}

function Entry({
  title,
  meta,
  place,
  sub,
  technologies = [],
  highlights,
}: {
  title: string;
  meta: string;
  /** The employer or school, on the line under the title. */
  place?: string;
  sub: string;
  technologies?: string[];
  highlights: string[];
}) {
  const subline = [place, sub].filter(Boolean);
  return (
    <View style={styles.entry}>
      <View wrap={false} minPresenceAhead={24}>
        <View style={styles.entryHead}>
          <Text style={styles.entryTitle}>{title}</Text>
          {meta ? <Text style={styles.entryMeta}>{meta}</Text> : null}
        </View>
        {subline.length > 0 ? (
          <Text style={styles.entrySub}>
            {place ? <Text style={styles.entryPlace}>{place}</Text> : null}
            {place && sub ? " | " : null}
            {sub}
          </Text>
        ) : null}
      </View>
      <Bullets items={highlights} />
      {technologies.length > 0 ? (
        <Text style={styles.tech}>
          <Text style={styles.label}>Tech: </Text>
          {technologies.join(", ")}
        </Text>
      ) : null}
    </View>
  );
}

function Skills({ cv }: { cv: CvView }) {
  // One category reads better as a plain line.
  if (cv.skillGroups.length <= 1) return <Text>{cv.skills.join(", ")}</Text>;
  return cv.skillGroups.map((group) => (
    <Text key={group.category} style={styles.skillLine}>
      <Text style={styles.label}>{group.category}: </Text>
      {group.names.join(", ")}
    </Text>
  ));
}

export function CvDocument({ cv }: { cv: CvView }) {
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
      <Page size="A4" style={styles.page}>
        <View style={styles.body}>
          <Header
            name={cv.name}
            headline={cv.headline}
            contact={cv.contact}
            links={cv.links}
          />

          {cv.summary ? (
            <Section title="Summary">
              <Text>{cv.summary}</Text>
            </Section>
          ) : null}

          {cv.skills.length > 0 ? (
            <Section title="Skills">
              <Skills cv={cv} />
            </Section>
          ) : null}

          {cv.experience.length > 0 ? (
            <Section title="Experience">
              {cv.experience.map((role) => (
                <Entry
                  key={role.id}
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
            <Section title="Projects">
              {cv.projects.map((project) => (
                <Entry
                  key={project.id}
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
            <Section title="Education">
              {cv.education.map((entry) => (
                <Entry
                  key={entry.id}
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
            <Section title="Certifications">
              <Bullets items={cv.certifications} />
            </Section>
          ) : null}

          {cv.languages.length > 0 ? (
            <Section title="Languages">
              <Text>{cv.languages.join(", ")}</Text>
            </Section>
          ) : null}
        </View>

        <Text
          fixed
          style={styles.footer}
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
}: {
  letter: LetterView;
  /** The date line, already formatted. */
  date: string;
}) {
  return (
    <Document
      title={`${letter.name} – Cover letter`}
      author={letter.name}
      creator="Job Agent"
    >
      <Page size="A4" style={{ ...styles.page, fontSize: 11, lineHeight: 1.4 }}>
        <Header
          name={letter.name}
          contact={letter.contact}
          links={letter.links}
        />
        <Text style={{ marginTop: 22, marginBottom: 16, color: MUTED }}>
          {date}
        </Text>
        <Text style={styles.paragraph}>{letter.greeting}</Text>
        {letter.paragraphs.map((paragraph, index) => (
          <Text key={index} style={styles.paragraph}>
            {paragraph}
          </Text>
        ))}
        <Text style={{ marginTop: 6 }}>{letter.closing}</Text>
        <Text>{letter.name}</Text>
      </Page>
    </Document>
  );
}

export async function renderCvPdf(cv: CvView): Promise<Uint8Array> {
  return new Uint8Array(await renderToBuffer(<CvDocument cv={cv} />));
}

/** How many pages a PDF drawn here has: one page object per page. */
export function pdfPageCount(bytes: Uint8Array): number {
  const text = new TextDecoder("latin1").decode(bytes);
  return text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
}

export async function renderLetterPdf(
  letter: LetterView,
  date: string,
): Promise<Uint8Array> {
  return new Uint8Array(
    await renderToBuffer(<LetterDocument letter={letter} date={date} />),
  );
}
