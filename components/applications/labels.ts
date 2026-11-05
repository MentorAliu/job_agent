/** "Mon 6 Oct", the way an application's page writes days. */
export const APPLICATION_DAY: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
};

/** "LH" for Lena Hartmann. */
export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase());
  return (
    letters.length > 1 ? letters[0]! + letters.at(-1)! : (letters[0] ?? "?")
  ).slice(0, 2);
}
