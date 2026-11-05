/** Legal suffixes that don't tell two companies apart. */
const SUFFIXES =
  /\b(inc|llc|ltd|gmbh|bv|sa|ag|co|corp|corporation|limited|plc|oy|ab|as|srl|sas)\b/g;

/** A company name compared loosely: no accents, case, punctuation or legal suffix. */
export function normalizeCompany(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Whether the owner listed this company under companies to exclude. */
export function isExcludedCompany(
  company: string,
  excluded: readonly string[],
): boolean {
  const name = normalizeCompany(company);
  if (name === "") return false;
  return excluded.some((entry) => {
    const other = normalizeCompany(entry);
    return other !== "" && (name === other || name.startsWith(`${other} `));
  });
}
