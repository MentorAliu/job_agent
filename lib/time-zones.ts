// The time zones a picker offers, grouped by region the way IANA names them:
// Africa, America, Asia, Europe and so on.

export type TimeZoneOption = { value: string; label: string };
export type TimeZoneGroup = { region: string; zones: TimeZoneOption[] };

/** Where names with no region, such as UTC, go: last. */
const OTHER = "Other";

/** A name's place, for its option: "Argentina / Buenos Aires" for America/Argentina/Buenos_Aires. */
export function placeName(zone: string): string {
  const parts = zone.split("/");
  const place = parts.length > 1 ? parts.slice(1) : parts;
  return place.join(" / ").replaceAll("_", " ");
}

/**
 * `names` grouped by region, A to Z, with `extra` (such as the saved time
 * zone and this computer's) added where `names` lacks them. A browser's list
 * can leave out UTC, or the saved name, so those are never lost.
 */
export function timeZoneGroups(
  names: readonly string[],
  extra: readonly (string | null | undefined)[] = [],
): TimeZoneGroup[] {
  const all = new Set(names);
  for (const zone of extra) if (zone) all.add(zone);
  const groups = new Map<string, TimeZoneOption[]>();
  for (const zone of [...all].sort()) {
    const slash = zone.indexOf("/");
    const region = slash > 0 ? zone.slice(0, slash) : OTHER;
    const group = groups.get(region) ?? [];
    group.push({ value: zone, label: slash > 0 ? placeName(zone) : zone });
    groups.set(region, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) =>
      a === OTHER ? 1 : b === OTHER ? -1 : a.localeCompare(b),
    )
    .map(([region, zones]) => ({ region, zones }));
}
