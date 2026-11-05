// A pasted email's text as Claude reads it: the newest message, and a little
// of the thread quoted under it, each cut to a size that keeps the call cheap.
import { MAX_EMAIL_CHARS, MAX_QUOTED_CHARS } from "@/lib/schemas/mail";

/** Lines where a reply's quoted thread starts. */
const QUOTE_STARTS = [
  /^On .{4,200} wrote:\s*$/gm,
  /^-{2,}\s*Original Message\s*-{2,}/gim,
  /^_{5,}\s*$/gm,
  /^From: .+\n(Sent|Date): /gm,
];

/**
 * Lines a paste may start with that belong to the newest message: its
 * headers, a forward banner, or blank lines.
 */
const LEADING_LINE =
  /^\s*(?:-{2,}\s*(?:Forwarded message|Original Message)\s*-{2,}|Begin forwarded message:|(?:From|Sent|Date|To|Cc|Subject):.*)?\s*$/i;

/** Spaces, tabs and no-break spaces squeezed, blank lines kept to one. */
const tidy = (text: string) =>
  text
    .replace(/[ \t ]+/g, " ")
    .replace(/\n[ \n]+/g, "\n\n")
    .trim();

const cap = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/** Where the header lines a paste starts with end. */
function headerEnd(text: string): number {
  let end = 0;
  for (const line of text.split("\n")) {
    if (!LEADING_LINE.test(line)) break;
    end += line.length + 1;
  }
  return end;
}

/**
 * Where the thread quoted under the newest message starts. A forwarded or
 * copied email's own headers at the top don't count.
 */
function quoteStart(text: string): number {
  const after = headerEnd(text);
  let start = text.length;
  for (const pattern of QUOTE_STARTS) {
    for (const match of text.matchAll(pattern)) {
      if (match.index > after) {
        start = Math.min(start, match.index);
        break;
      }
    }
  }
  return start;
}

/**
 * An email split into its newest message and the thread quoted under it,
 * each tidied and capped. Lines starting with ">" count as quoted.
 */
export function splitEmail(
  body: string,
  max = MAX_EMAIL_CHARS,
  maxQuoted = MAX_QUOTED_CHARS,
): { newest: string; quoted: string } {
  const text = body.replace(/\r\n?/g, "\n");
  const start = quoteStart(text);
  const lines = text.slice(0, start).split("\n");
  const newest = lines.filter((line) => !line.startsWith(">")).join("\n");
  const quoted = [
    ...lines.filter((line) => line.startsWith(">")),
    text.slice(start),
  ]
    .join("\n")
    .replace(/^>+ ?/gm, "");
  return {
    newest: cap(tidy(newest), max),
    quoted: cap(tidy(quoted), maxQuoted),
  };
}

const squash = (text: string) =>
  text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** Whether Claude's quote really is in the email, ignoring case and spacing. */
export function quoteIsInEmail(quote: string, text: string): boolean {
  const wanted = squash(quote).replace(/…$/, "");
  return wanted.length >= 8 && squash(text).includes(wanted);
}
