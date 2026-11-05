import type { ChartConfig } from "@/components/ui/chart";
import type { DaySpend } from "@/lib/dal/spend";
import type { StageGroup } from "@/lib/schemas/settings";

// Shared by the Runs page's server sections and its charts, which run in the
// browser.

/** Each group of steps' name and color, in the order the charts stack them. */
export const SPEND_GROUPS = {
  searching: { label: "Searching", color: "var(--chart-1)" },
  kits: { label: "Apply kits", color: "var(--chart-2)" },
  cv: { label: "CVs", color: "var(--chart-3)" },
  email: { label: "Reading replies", color: "var(--chart-4)" },
  checks: { label: "Provider checks", color: "var(--chart-5)" },
} satisfies Record<StageGroup, { label: string; color: string }> & ChartConfig;

export const GROUPS = Object.keys(SPEND_GROUPS) as StageGroup[];

export const dayTotal = (day: DaySpend) =>
  GROUPS.reduce((sum, group) => sum + day[group], 0);

/** One step and model in the Cost by step chart. */
export type StepRow = {
  key: string;
  group: StageGroup;
  /** "Search job boards" */
  label: string;
  /** "Haiku 5.5" */
  model: string;
  /** "Claude Haiku 5.5, half-price batch" */
  detail: string;
  costUsd: number;
  calls: number;
};

/** Steps up the chart's axis: 1, 2, 2.5 or 5 times a power of ten. */
export function chartScale(most: number): { top: number; ticks: number[] } {
  if (most <= 0) return { top: 1, ticks: [] };
  const rough = most / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10]
    .map((factor) => factor * power)
    .find((candidate) => candidate >= rough)!;
  const count = Math.ceil(most / step - 1e-9);
  const ticks = Array.from({ length: count }, (_, index) =>
    Number((step * (index + 1)).toFixed(6)),
  );
  return { top: ticks.at(-1)!, ticks };
}

/** "$0.10", or "$0.025" when the cents need it. "$0" at the baseline. */
export function formatTick(usd: number): string {
  if (usd === 0) return "$0";
  const cents = usd.toFixed(2);
  return `$${Math.abs(Number(cents) - usd) < 1e-9 ? cents : usd.toFixed(3)}`;
}
