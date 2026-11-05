// How profile entries read, in the editor and on the profile summary.

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "1 role", "5 roles". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "2022-09" as "Sep 2022". Anything else, such as "2019", stays as it is. */
export function formatMonth(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  const month = match ? Number(match[2]) : 0;
  return match && month >= 1 && month <= 12
    ? `${MONTHS[month - 1]} ${match[1]}`
    : value.trim();
}

/** "Sep 2022 to Oct 2025", "Sep 2022 to now", or as much as is known. */
export function dateRange(start: string, end: string, current = false): string {
  const from = formatMonth(start);
  const to = current ? "now" : formatMonth(end);
  if (from && to) return `${from} to ${to}`;
  return from || (to ? `until ${to}` : "");
}
