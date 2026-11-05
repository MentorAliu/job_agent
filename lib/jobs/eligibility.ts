// Step 5 of the pipeline: a hard eligibility check in code. It compares the
// location and time zone rules Claude copied out of a posting with the
// owner's countries and time zones, and only trusts a rule it can find, word
// for word, in the fetched page. With remote only, a role that isn't fully
// remote is never eligible.
import type { Preferences } from "@/lib/schemas/profile";
import type { Eligibility, JobFacts } from "@/lib/schemas/job";

import {
  countryCode,
  normalizePlace,
  placeCovers,
  resolvePlace,
} from "./places";

export type EligibilityResult = {
  eligibility: Eligibility;
  /** The posting's own words the verdict rests on. Empty when it says nothing. */
  quote: string;
  /** Why, in plain sentences, for the run page and the tracker. */
  reasons: string[];
};

type Signal = { value: boolean | null; reason: string; quote: string };

export function checkEligibility(
  facts: Pick<JobFacts, "location" | "timeZones">,
  preferences: Pick<Preferences, "remoteOnly" | "countries" | "timeZones">,
  /** The fetched page. When given, a quote that isn't in it is ignored. */
  pageText?: string,
): EligibilityResult {
  const locationQuote = facts.location.quote.trim();
  const zoneQuote = facts.timeZones.quote.trim();
  const signals: Signal[] = [];

  const locationTrusted = trustQuote(
    locationQuote,
    pageText,
    signals,
    "location",
  );
  // Claude's call on remote, hybrid or on-site counts even without a quote:
  // with remote only, a wrong call can only hide a role, never let one in.
  signals.push(
    checkWorkplace(
      facts.location.workplace,
      preferences.remoteOnly,
      locationTrusted ? locationQuote : "",
    ),
  );
  if (locationTrusted) {
    signals.push(
      ...checkPlaces(facts.location, preferences.countries, locationQuote),
    );
  } else if (
    locationQuote === "" &&
    (facts.location.allowed.length > 0 || facts.location.excluded.length > 0)
  ) {
    signals.push({
      value: null,
      reason:
        "Claude listed places without quoting the posting, so they were ignored.",
      quote: "",
    });
  }

  if (trustQuote(zoneQuote, pageText, signals, "time zone")) {
    signals.push(
      checkTimeZones(facts.timeZones, preferences.timeZones, zoneQuote),
    );
  }

  return decide(signals, locationTrusted ? locationQuote : "", zoneQuote);
}

function decide(
  signals: Signal[],
  locationQuote: string,
  zoneQuote: string,
): EligibilityResult {
  const reasons = (list: Signal[]) =>
    list.map((signal) => signal.reason).filter((reason) => reason !== "");

  const blockers = signals.filter((signal) => signal.value === false);
  if (blockers.length > 0) {
    return {
      eligibility: "not_eligible",
      quote: blockers[0].quote,
      reasons: reasons(blockers),
    };
  }
  const passes = signals.filter((signal) => signal.value === true);
  if (passes.length > 0) {
    return {
      eligibility: "eligible",
      quote: passes[0].quote,
      reasons: reasons(signals),
    };
  }
  const notes = reasons(signals);
  return {
    eligibility: "unclear",
    quote: locationQuote || zoneQuote,
    reasons:
      notes.length > 0
        ? notes
        : ["The posting doesn't say where you can work from."],
  };
}

/**
 * Whether a section's rule can be used: it has a quote, and the quote is in
 * the page. A quote that isn't adds a note saying it was ignored.
 */
function trustQuote(
  quote: string,
  pageText: string | undefined,
  signals: Signal[],
  label: string,
): boolean {
  if (quote === "") return false;
  if (pageText === undefined || quoteInPage(quote, pageText)) return true;
  signals.push({
    value: null,
    reason: `The ${label} rule Claude quoted isn't in the posting, so it was ignored.`,
    quote: "",
  });
  return false;
}

/**
 * With remote only, a role must be fully remote: hybrid, on-site and
 * postings that don't say are all ruled out.
 */
function checkWorkplace(
  workplace: JobFacts["location"]["workplace"],
  remoteOnly: boolean,
  quote: string,
): Signal {
  if (!remoteOnly || workplace === "remote") {
    return { value: null, reason: "", quote };
  }
  return {
    value: false,
    reason:
      workplace === "onsite" || workplace === "hybrid"
        ? `The role is ${workplace === "onsite" ? "on-site" : "hybrid"}, and you want remote work only.`
        : "The posting doesn't say the role is remote, and you want remote work only.",
    quote,
  };
}

/** "A, B and C" or "A, B or C". */
function listOf(
  items: readonly string[],
  type: "conjunction" | "disjunction",
): string {
  return new Intl.ListFormat("en", { style: "long", type }).format(items);
}

function checkPlaces(
  location: Pick<JobFacts["location"], "allowed" | "excluded" | "placesAre">,
  ownerCountries: readonly string[],
  quote: string,
): Signal[] {
  const codes = ownerCountries
    .map(countryCode)
    .filter((code): code is string => code !== null);
  const names = ownerCountries.map(normalizePlace);
  const owner = listOf(ownerCountries, "conjunction");
  // A country this module doesn't know still matches its own name.
  const covers = (place: string) =>
    names.includes(normalizePlace(place)) || placeCovers(place, codes);

  const signals: Signal[] = [];
  const excluded = location.excluded.filter((place) => covers(place) === true);
  if (excluded.length > 0) {
    signals.push({
      value: false,
      reason: `The posting excludes ${listOf(excluded, "conjunction")}, and you work from ${owner}.`,
      quote,
    });
  }

  const allowed = location.allowed.filter((place) => place.trim() !== "");
  if (allowed.length === 0) return signals;
  const verdicts = allowed.map(covers);
  const matched = allowed.filter((_, index) => verdicts[index] === true);
  const unknown = allowed.filter((_, index) => verdicts[index] === null);
  // Only a requirement can rule the owner out.
  if (location.placesAre === "team_locations") {
    signals.push({
      value: null,
      reason: `The posting says where its team is (${listOf(allowed, "conjunction")}), not where you must live.`,
      quote,
    });
  } else if (location.placesAre === "preferred" && matched.length === 0) {
    signals.push({
      value: null,
      reason: `The posting prefers candidates in ${listOf(allowed, "disjunction")}, but doesn't rule out ${owner}.`,
      quote,
    });
  } else if (matched.length > 0) {
    signals.push({
      value: true,
      reason:
        resolvePlace(matched[0]).kind === "worldwide"
          ? "The posting is open worldwide."
          : location.placesAre === "preferred"
            ? `The posting prefers candidates in ${matched[0]}, which includes ${owner}.`
            : `The posting is open to ${matched[0]}, which includes ${owner}.`,
      quote,
    });
  } else if (unknown.length === 0) {
    signals.push({
      value: false,
      reason: `The posting is only open to ${listOf(allowed, "disjunction")}, and you work from ${owner}.`,
      quote,
    });
  } else {
    signals.push({
      value: null,
      reason: `The posting is open to ${listOf(unknown, "disjunction")}, which this app can't match to ${owner}.`,
      quote,
    });
  }
  return signals;
}

function checkTimeZones(
  zones: JobFacts["timeZones"],
  ownerZones: readonly string[],
  quote: string,
): Signal {
  const window = parseTimeZoneWindow(quote) ?? claudeWindow(zones);
  if (!window) return { value: null, reason: "", quote };

  const range = describeWindow(window);
  let partial: string | null = null;
  for (const zone of ownerZones) {
    const offsets = ownerOffsets(zone);
    if (!offsets) continue;
    const inside = SEASONS.filter((season) =>
      within(offsets[season], window[season]),
    );
    if (inside.length === SEASONS.length) {
      return {
        value: true,
        reason: `Your time zone ${zone} is inside the posting's window (${range}).`,
        quote,
      };
    }
    if (inside.length > 0) partial ??= zone;
  }
  if (partial) {
    return {
      value: null,
      reason: `Your time zone ${partial} is inside the posting's window (${range}) for only part of the year.`,
      quote,
    };
  }
  return {
    value: false,
    reason: `The posting asks for ${range}, outside your time zones (${ownerZones.join(", ")}).`,
    quote,
  };
}

// ---------------------------------------------------------------------------
// Time zone windows
// ---------------------------------------------------------------------------

/**
 * A window of UTC offsets in hours, in January and in July. Postings that say
 * "CET" mean Central European time all year, so the window moves with
 * summer time the way the owner's own zone does.
 */
export type TimeZoneWindow = Record<Season, { min: number; max: number }>;
type Season = "january" | "july";
const SEASONS: Season[] = ["january", "july"];

/** UTC offsets in January and July for the abbreviations postings use. */
const ZONE_OFFSETS: Record<string, [january: number, july: number]> = {
  UTC: [0, 0],
  GMT: [0, 0],
  WET: [0, 1],
  WEST: [1, 1],
  BST: [1, 1],
  CET: [1, 2],
  CEST: [2, 2],
  EET: [2, 3],
  EEST: [3, 3],
  MSK: [3, 3],
  GST: [4, 4],
  IST: [5.5, 5.5],
  SGT: [8, 8],
  JST: [9, 9],
  AEST: [10, 10],
  AEDT: [11, 11],
  ET: [-5, -4],
  EST: [-5, -4],
  EDT: [-4, -4],
  CT: [-6, -5],
  CST: [-6, -5],
  CDT: [-5, -5],
  MT: [-7, -6],
  MST: [-7, -6],
  MDT: [-6, -6],
  PT: [-8, -7],
  PST: [-8, -7],
  PDT: [-7, -7],
};

const ZONE = `(${Object.keys(ZONE_OFFSETS).join("|")})(?![A-Za-z])`;
const OFFSET = String.raw`(?:\s*([+\-−–])\s*(\d{1,2})(?::?(\d{2}))?)?`;
const POINT = new RegExp(String.raw`\b${ZONE}${OFFSET}`, "g");
const PLUS_MINUS =
  /^\s*(?:±|\+\/-|\+-|-\/\+|plus or minus|plus\/minus)\s*(\d{1,2}(?:\.\d+)?)/i;
const RANGE_JOINER = /^\s*(?:to|-|–|—|and|through|until)\s*$/i;
const WITHIN = new RegExp(
  String.raw`(?:within|±|\+\/-)\s*(\d{1,2})\s*h(?:ours?|rs?)?\s*(?:of|from)\s*${ZONE}${OFFSET}`,
  "i",
);

/**
 * Reads a time zone window from a posting's own words, such as "CET ±2",
 * "UTC-1 to UTC+3" or "within 3 hours of GMT". Null when the words don't
 * give a range in one of these forms.
 */
export function parseTimeZoneWindow(quote: string): TimeZoneWindow | null {
  const nearby = WITHIN.exec(quote);
  if (nearby)
    return spread(pointOffsets(nearby.slice(2, 6)), Number(nearby[1]));

  const points = [...quote.matchAll(POINT)];
  if (points.length === 0) return null;
  const first = points[0];
  const start = pointOffsets(first.slice(1, 5));
  const firstEnd = (first.index ?? 0) + first[0].length;

  const plusMinus = PLUS_MINUS.exec(quote.slice(firstEnd));
  if (plusMinus) return spread(start, Number(plusMinus[1]));

  const second = points[1];
  if (second && RANGE_JOINER.test(quote.slice(firstEnd, second.index))) {
    const end = pointOffsets(second.slice(1, 5));
    return {
      january: ordered(start[0], end[0]),
      july: ordered(start[1], end[1]),
    };
  }
  return null;
}

/** The window Claude worked out, used when the quote isn't in a known form. */
function claudeWindow(zones: JobFacts["timeZones"]): TimeZoneWindow | null {
  if (zones.utcOffsetMin === null || zones.utcOffsetMax === null) return null;
  const range = ordered(zones.utcOffsetMin, zones.utcOffsetMax);
  return { january: range, july: range };
}

/** [zone, sign, hours, minutes] from a POINT match, as January and July offsets. */
function pointOffsets([zone, sign, hours, minutes]: (string | undefined)[]): [
  number,
  number,
] {
  const [january, july] = ZONE_OFFSETS[(zone ?? "").toUpperCase()] ?? [0, 0];
  if (!sign || !hours) return [january, july];
  const shift =
    (Number(hours) + Number(minutes ?? 0) / 60) * (sign === "+" ? 1 : -1);
  return [january + shift, july + shift];
}

function spread(
  [january, july]: [number, number],
  hours: number,
): TimeZoneWindow {
  return {
    january: { min: january - hours, max: january + hours },
    july: { min: july - hours, max: july + hours },
  };
}

function ordered(a: number, b: number) {
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function within(offset: number, range: { min: number; max: number }) {
  return offset >= range.min && offset <= range.max;
}

/** A zone's UTC offsets in January and July, or null for an unknown zone. */
export function ownerOffsets(timeZone: string): Record<Season, number> | null {
  const january = utcOffset(timeZone, new Date(Date.UTC(2026, 0, 15)));
  const july = utcOffset(timeZone, new Date(Date.UTC(2026, 6, 15)));
  return january === null || july === null ? null : { january, july };
}

function utcOffset(timeZone: string, at: Date): number | null {
  try {
    const name = new Intl.DateTimeFormat("en", {
      timeZone,
      timeZoneName: "longOffset",
    })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value;
    const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name ?? "");
    if (!match) return null;
    if (!match[1]) return 0;
    const hours = Number(match[2]) + Number(match[3]) / 60;
    return match[1] === "+" ? hours : -hours;
  } catch {
    return null;
  }
}

function describeWindow(window: TimeZoneWindow): string {
  const range = ({ min, max }: { min: number; max: number }) =>
    min === max
      ? formatOffset(min)
      : `${formatOffset(min)} to ${formatOffset(max)}`;
  const winter = range(window.january);
  const summer = range(window.july);
  return winter === summer
    ? winter
    : `${winter} in winter, ${summer} in summer`;
}

function formatOffset(hours: number): string {
  if (hours === 0) return "UTC";
  const sign = hours > 0 ? "+" : "-";
  const whole = Math.trunc(Math.abs(hours));
  const minutes = Math.round((Math.abs(hours) - whole) * 60);
  return `UTC${sign}${whole}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

/**
 * Text compared loosely: Markdown links and emphasis, curly quotes, dashes,
 * case and runs of whitespace don't count.
 */
function looseText(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|]/g, " ")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Whether a quote appears in the page, compared loosely. */
export function quoteInPage(quote: string, pageText: string): boolean {
  const needle = looseText(quote).replace(/[.,;:!]+$/, "");
  return needle !== "" && looseText(pageText).includes(needle);
}
