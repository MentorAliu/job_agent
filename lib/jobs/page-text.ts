// A posting's page as text, for a command-line agent, which can't fetch
// pages: what a reader sees, with the posting's structured data (JSON-LD) on
// top, since many careers pages draw the posting with a script.

/** About as much as web fetch keeps: 12,000 tokens at 4 characters each. */
export const MAX_PAGE_CHARS = 48_000;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  bull: "•",
  middot: "·",
  euro: "€",
  pound: "£",
};

/** Named and numeric character references, in one pass. */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity, name: string) => {
      if (name.startsWith("#")) {
        const code =
          name[1] === "x" || name[1] === "X"
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10);
        return code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : entity;
      }
      return ENTITIES[name.toLowerCase()] ?? entity;
    },
  );
}

/** HTML as plain text, keeping its line breaks and list items. */
export function htmlToText(html: string): string {
  const text = html
    .replace(
      /<(script|style|noscript|template|svg|head|iframe)\b[\s\S]*?<\/\1\s*>/gi,
      " ",
    )
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(
      /<\/?(p|div|section|article|header|footer|main|aside|nav|ul|ol|li|h[1-6]|br|hr|tr|table|dl|dt|dd|blockquote|pre)\b[^>]*>/gi,
      "\n",
    )
    .replace(/<\/?(td|th)\b[^>]*>/gi, " ")
    // Inline tags, such as <b> or <a>, sit inside a line.
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Every object in a JSON-LD block, including those in `@graph` and lists. */
function* ldObjects(value: unknown): Generator<Json> {
  if (Array.isArray(value)) {
    for (const item of value) yield* ldObjects(item);
  } else if (isObject(value)) {
    yield value;
    if (value["@graph"]) yield* ldObjects(value["@graph"]);
  }
}

function isJobPosting(value: Json): boolean {
  const type = value["@type"];
  return Array.isArray(type)
    ? type.includes("JobPosting")
    : type === "JobPosting";
}

/** The JobPosting in the page's JSON-LD, if it has one. */
function jobPostingData(html: string): Json | null {
  const scripts = html.matchAll(
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi,
  );
  for (const [, body] of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.trim());
    } catch {
      continue;
    }
    for (const object of ldObjects(parsed)) {
      if (isJobPosting(object)) return object;
    }
  }
  return null;
}

/** A JSON-LD value as short text: a string, a name, or a list of them. */
function ldText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map(ldText).filter(Boolean).join("; ");
  }
  if (!isObject(value)) return "";
  if (typeof value.name === "string") return value.name.trim();
  if (isObject(value.address)) return ldText(value.address);
  const place = [
    value.addressLocality,
    value.addressRegion,
    value.addressCountry,
  ].map(ldText);
  if (place.some(Boolean)) return place.filter(Boolean).join(", ");
  const amount = isObject(value.value) ? value.value : value;
  const range = [amount.minValue, amount.maxValue].map(ldText).filter(Boolean);
  if (range.length > 0) {
    return [range.join("–"), ldText(value.currency), ldText(amount.unitText)]
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

const LD_FIELDS: [label: string, key: string][] = [
  ["Title", "title"],
  ["Company", "hiringOrganization"],
  ["Posted", "datePosted"],
  ["Open until", "validThrough"],
  ["Employment type", "employmentType"],
  ["Location type", "jobLocationType"],
  ["Applicants must be in", "applicantLocationRequirements"],
  ["Job location", "jobLocation"],
  ["Salary", "baseSalary"],
];

/**
 * The page's text for reading a posting: its JSON-LD facts, then what a
 * reader sees, or the JSON-LD description when the page itself shows less.
 * Cut at MAX_PAGE_CHARS.
 */
export function pageText(html: string): string {
  const data = jobPostingData(html);
  const visible = htmlToText(html);
  if (!data) return visible.slice(0, MAX_PAGE_CHARS);

  const facts = LD_FIELDS.flatMap(([label, key]) => {
    const value = ldText(data[key]);
    return value ? [`${label}: ${value}`] : [];
  });
  const description =
    typeof data.description === "string"
      ? htmlToText(decodeEntities(data.description))
      : "";
  const body =
    description.length > 0 && visible.length < description.length / 2
      ? description
      : visible;
  return [facts.join("\n"), body]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_PAGE_CHARS);
}
