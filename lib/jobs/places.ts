// Countries and the regions job postings name ("EU", "EMEA", "LATAM"…), so
// the eligibility check can tell whether a posting's location rule covers the
// owner's countries. Countries are ISO 3166 alpha-2 codes; their names come
// from Intl plus the aliases postings use.

const codes = (list: string) => list.split(" ");

const EU = codes(
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE",
);
const EEA = [...EU, ...codes("IS LI NO")];
const EUROPE = [
  ...EEA,
  ...codes(
    "AD AL AX BA BY CH FO GB GG GI IM JE MC MD ME MK RS RU SJ SM UA VA XK",
  ),
];
const MIDDLE_EAST = codes("AE BH EG IL IQ IR JO KW LB OM PS QA SA SY TR YE");
const AFRICA = codes(
  "AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW",
);
const NORTH_AMERICA = codes("US CA MX");
const CENTRAL_AMERICA = codes("BZ CR GT HN NI PA SV");
const CARIBBEAN = codes(
  "AG AI AW BB BS CU CW DM DO GD HT JM KN KY LC PR TT VC",
);
const SOUTH_AMERICA = codes("AR BO BR CL CO EC GY PE PY SR UY VE");
const LATAM = ["MX", ...CENTRAL_AMERICA, ...CARIBBEAN, ...SOUTH_AMERICA];
const AMERICAS = [...NORTH_AMERICA, ...LATAM, ...codes("BM GL")];
const OCEANIA = codes("AU FJ FM KI MH NC NR NZ PF PG PW SB TO TV VU WS");
const ASIA = [
  ...codes(
    "AF AM AZ BD BN BT CN GE HK ID IN JP KG KH KR KZ LA LK MM MN MO MV MY NP PH PK SG TH TJ TL TM TW UZ VN",
  ),
  ...MIDDLE_EAST.filter((code) => code !== "EG"),
];
const APAC = codes(
  "AU BD BN CN FJ HK ID IN JP KH KR LA LK MM MN MO MY NP NZ PG PH PK SG TH TW VN",
);
const BALKANS = codes("AL BA BG GR HR ME MK RO RS SI XK");
const WESTERN_BALKANS = codes("AL BA ME MK RS XK");
const CEE = codes(
  "AL BA BG BY CZ EE HR HU LT LV MD ME MK PL RO RS RU SI SK UA XK",
);

/** Region names, as postings write them, and the countries they cover. */
const REGIONS: [names: string[], countries: string[]][] = [
  [["eu", "european union", "eu member states", "eu countries"], EU],
  [["eea", "european economic area"], EEA],
  [["europe", "european countries"], EUROPE],
  [
    ["emea", "europe middle east and africa"],
    [...EUROPE, ...MIDDLE_EAST, ...AFRICA],
  ],
  [["middle east", "mena"], MIDDLE_EAST],
  [["africa"], AFRICA],
  [["north america"], NORTH_AMERICA],
  [["central america"], CENTRAL_AMERICA],
  [["caribbean"], CARIBBEAN],
  [["south america"], SOUTH_AMERICA],
  [["latam", "latin america"], LATAM],
  [["americas"], AMERICAS],
  [["oceania"], OCEANIA],
  [["asia"], ASIA],
  [["apac", "asia pacific"], APAC],
  [["dach"], codes("DE AT CH")],
  [["nordics", "nordic countries", "scandinavia"], codes("DK FI IS NO SE")],
  [["baltics", "baltic states"], codes("EE LV LT")],
  [["benelux"], codes("BE NL LU")],
  [["balkans"], BALKANS],
  [["western balkans"], WESTERN_BALKANS],
  [
    ["cee", "central and eastern europe", "eastern europe", "central europe"],
    CEE,
  ],
];

const WORLDWIDE = new Set([
  "worldwide",
  "anywhere",
  "global",
  "globally",
  "anywhere in the world",
  "international",
]);

/** Other names postings use for a country. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ["usa", "us", "u s", "u s a", "united states of america", "america"],
  GB: [
    "uk",
    "u k",
    "great britain",
    "britain",
    "england",
    "scotland",
    "wales",
    "northern ireland",
  ],
  AE: ["uae", "u a e"],
  BA: ["bosnia", "bosnia and herzegovina"],
  CZ: ["czech republic"],
  TR: ["turkey", "turkiye"],
  NL: ["holland"],
  KR: ["korea", "republic of korea"],
  MK: ["macedonia"],
  XK: ["kosova", "republic of kosovo"],
  RU: ["russian federation"],
  CI: ["ivory coast"],
  CD: ["democratic republic of the congo", "dr congo", "drc"],
  CG: ["republic of the congo", "congo"],
  VN: ["viet nam"],
  PS: ["palestine"],
  VA: ["vatican", "holy see"],
  SZ: ["swaziland"],
  CV: ["cabo verde"],
  TL: ["east timor"],
};

// Codes Intl names that aren't countries a posting would mean, or that
// duplicate a current code.
const NOT_COUNTRIES = new Set(
  codes(
    "AN BU CP CQ CS DD DG DY EA EU EZ FX HV IC NH QO RH SU TA TP UK UN VD XA XB YD YU ZR ZZ",
  ),
);

/**
 * Lowercase, no accents, "&" as "and", no punctuation, and no "only",
 * "based" or "remote": "Bosnia & Herzegovina" and "US only" both normalize.
 */
export function normalizePlace(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(only|based|remote)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the /, "");
}

function buildCountryNames(): Map<string, string> {
  const names = new Map<string, string>();
  const display = new Intl.DisplayNames("en", {
    type: "region",
    fallback: "none",
  });
  const add = (name: string, code: string) => {
    const key = normalizePlace(name);
    if (key !== "" && !names.has(key)) names.set(key, code);
  };
  for (let first = 65; first <= 90; first++) {
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second);
      if (NOT_COUNTRIES.has(code)) continue;
      const name = display.of(code);
      if (!name) continue;
      add(name, code);
      // "Hong Kong SAR China" and "Myanmar (Burma)" also go by the short form.
      add(name.replace(/\(.*\)|SAR China/g, ""), code);
    }
  }
  for (const [code, aliases] of Object.entries(COUNTRY_ALIASES)) {
    for (const alias of aliases) names.set(normalizePlace(alias), code);
  }
  return names;
}

let countryNames: Map<string, string> | undefined;
let regionNames: Map<string, ReadonlySet<string>> | undefined;

function lookups() {
  countryNames ??= buildCountryNames();
  regionNames ??= new Map(
    REGIONS.flatMap(([names, countries]) =>
      names.map((name) => [normalizePlace(name), new Set(countries)] as const),
    ),
  );
  return { countryNames, regionNames };
}

/** A place a posting names, resolved to the countries it covers. */
export type Place =
  | { kind: "worldwide" }
  | { kind: "country"; code: string }
  | { kind: "region"; countries: ReadonlySet<string> }
  | { kind: "unknown" };

export function resolvePlace(name: string): Place {
  const key = normalizePlace(name);
  if (key === "") return { kind: "unknown" };
  if (WORLDWIDE.has(key)) return { kind: "worldwide" };
  const { countryNames, regionNames } = lookups();
  const region = regionNames.get(key);
  if (region) return { kind: "region", countries: region };
  const code = countryNames.get(key);
  if (code) return { kind: "country", code };
  return { kind: "unknown" };
}

/** The ISO code for a country name, or null when it isn't a known country. */
export function countryCode(name: string): string | null {
  const place = resolvePlace(name);
  return place.kind === "country" ? place.code : null;
}

/**
 * Whether a place covers one of the given country codes: true or false for a
 * known place, null for a name this module doesn't know.
 */
export function placeCovers(
  name: string,
  countries: readonly string[],
): boolean | null {
  const place = resolvePlace(name);
  switch (place.kind) {
    case "worldwide":
      return true;
    case "country":
      return countries.includes(place.code);
    case "region":
      return countries.some((code) => place.countries.has(code));
    case "unknown":
      return null;
  }
}
