import type { SalaryView } from "@/lib/dal/jobs";
import type { JobFacts } from "@/lib/schemas/job";
import type { DocumentKind } from "@/lib/schemas/tailor";
import type { JobStatus } from "@/lib/schemas/tracker";

export const STATUS_LABELS: Record<JobStatus, string> = {
  new: "Waiting",
  shortlisted: "Picked",
  ready: "Ready",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  no_response: "No response",
  withdrawn: "Withdrawn",
  skipped: "Passed over",
  not_eligible: "Not eligible",
  listing_closed: "Listing closed",
  removed: "Removed",
};

/**
 * The statuses in the order the status menu lists them. Removed has its own
 * Remove and Restore buttons.
 */
export const STATUS_GROUPS: { label: string; statuses: JobStatus[] }[] = [
  { label: "Not sent", statuses: ["new", "shortlisted", "ready"] },
  { label: "Sent", statuses: ["applied", "interviewing", "offer"] },
  { label: "Closed", statuses: ["rejected", "no_response", "withdrawn"] },
  {
    label: "Passed over",
    statuses: ["skipped", "not_eligible", "listing_closed"],
  },
];

export const WORKPLACE_LABELS: Record<
  JobFacts["location"]["workplace"],
  string
> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
  unclear: "Workplace unclear",
};

export const SENIORITY_LABELS: Record<JobFacts["seniority"], string> = {
  junior: "Junior",
  mid: "Mid-level",
  senior: "Senior",
  lead: "Lead",
  principal: "Principal",
  unclear: "Seniority unclear",
};

export const CONTRACT_LABELS: Record<JobFacts["contract"], string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  freelance: "Freelance",
  internship: "Internship",
  unclear: "Contract unclear",
};

const PERIOD_LABELS: Record<SalaryView["period"], string> = {
  year: "a year",
  month: "a month",
  day: "a day",
  hour: "an hour",
  unclear: "",
};

function compact(amount: number): string {
  return new Intl.NumberFormat("en", {
    notation: amount >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(amount);
}

/** "EUR 60K–80K a year" */
export function formatSalary(salary: SalaryView): string {
  const range =
    salary.min !== null && salary.max !== null && salary.min !== salary.max
      ? `${compact(salary.min)}–${compact(salary.max)}`
      : compact((salary.max ?? salary.min)!);
  return [salary.currency, range, PERIOD_LABELS[salary.period]]
    .filter(Boolean)
    .join(" ");
}

const SHORT_PERIODS: Record<SalaryView["period"], string> = {
  year: "",
  month: "/mo",
  day: "/day",
  hour: "/hr",
  unclear: "",
};

/** The currency's symbol, such as "€", or its code when it has none. */
function currencySymbol(currency: string): string {
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? currency
    );
  } catch {
    return currency;
  }
}

/** "€80–95K", "CHF 120K" or "$45/hr", for a table cell. */
export function formatSalaryShort(salary: SalaryView): string {
  const amounts = [salary.min, salary.max].filter(
    (amount): amount is number => amount !== null,
  );
  const [low, high] = [
    compact(Math.min(...amounts)),
    compact(Math.max(...amounts)),
  ];
  const unit = (text: string) => /[KMB]$/.exec(text)?.[0] ?? "";
  const range =
    low === high
      ? low
      : unit(low) !== "" && unit(low) === unit(high)
        ? `${low.slice(0, -1)}–${high}`
        : `${low}–${high}`;
  const symbol = currencySymbol(salary.currency);
  const amount = /^[A-Za-z]{2,}$/.test(symbol)
    ? `${symbol} ${range}`
    : `${symbol}${range}`;
  return `${amount}${SHORT_PERIODS[salary.period]}`;
}

/** Where the role is done from: "Remote, Europe" or "Hybrid, Germany +2". */
export function formatWhere(
  workplace: JobFacts["location"]["workplace"] | null,
  places: string[],
): string {
  const label = WORKPLACE_LABELS[workplace ?? "unclear"];
  if (places.length === 0) return label;
  const named = places.slice(0, 2).join(", ");
  const more = places.length > 2 ? ` +${places.length - 2}` : "";
  return `${label}, ${named}${more}`;
}

/** The seniority and contract, such as "Senior · Full-time", or null if neither is known. */
export function formatLevel(
  seniority: JobFacts["seniority"] | null,
  contract: JobFacts["contract"] | null,
): string | null {
  const parts = [
    seniority && seniority !== "unclear" ? SENIORITY_LABELS[seniority] : null,
    contract && contract !== "unclear" ? CONTRACT_LABELS[contract] : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** How a score reads, in the bands the scoring prompt gives Claude. */
export function matchLabel(score: number): string {
  if (score >= 80) return "Strong match";
  if (score >= 50) return "Partial match";
  return "Weak match";
}

/** The site a posting is on, such as "greenhouse.io". */
export function postingSite(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^(www|jobs|boards|careers)\./, "");
  } catch {
    return null;
  }
}

/** A "YYYY-MM-DD" day, such as "18 Oct 2026". */
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

/** A "YYYY-MM-DD" day without its year when it's this year, such as "2 Nov". */
export function formatShortDay(day: string, today: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  cv: "CV",
  cover_letter: "cover letter",
  answers: "answers",
};
