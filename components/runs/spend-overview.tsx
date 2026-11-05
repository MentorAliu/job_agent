import {
  CheckIcon,
  CircleAlertIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import type { MonthActivity, SpendSummary, StageCost } from "@/lib/dal/spend";
import { modelName, STAGE_GROUPS } from "@/lib/schemas/settings";
import { cn } from "@/lib/utils";

import { BudgetMeter } from "./budget-meter";
import {
  formatBudget,
  formatCost,
  LLM_STAGE_LABELS,
  monthPace,
  shortDay,
} from "./run-labels";
import {
  dayTotal,
  GROUPS,
  SPEND_GROUPS,
  type StepRow,
} from "./spend-chart-config";
import { CostByStepChart, SpendPerDayChart } from "./spend-charts";
import { StageCostTable } from "./stage-costs";
import { TokensDialog } from "./tokens-dialog";

const monthName = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(
    new Date(iso),
  );

const card = "rounded-xl border bg-card shadow-xs";

/** This month at a glance: spend, where it's heading, searches and kits. */
export function SpendStats({
  activity,
  now,
}: {
  activity: MonthActivity;
  now: Date;
}) {
  const limit = activity.limits.monthlyUsd;
  const { started, failed, stopped } = activity.searches;
  const trouble = [
    failed > 0 ? `${failed} failed` : null,
    stopped > 0 ? `${stopped} stopped` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const pace = monthPace(activity, now);
  return (
    <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Stat
        label="Spent this month"
        value={formatCost(activity.spentUsd)}
        unit={`of ${formatBudget(limit)}`}
      >
        <BudgetMeter spentUsd={activity.spentUsd} limitUsd={limit} />
        <span>Resets on {shortDay(activity.nextMonthStart)}</span>
      </Stat>
      <Stat label="On pace for" value={pace === null ? "—" : formatCost(pace)}>
        <PaceVerdict pace={pace} spent={activity.spentUsd} limit={limit} />
      </Stat>
      <Stat label="Searches" value={String(started)}>
        <span>
          {started > 0
            ? `${formatCost(activity.costs.searching / started)} each on average`
            : "None yet this month"}
          {trouble ? ` · ${trouble}` : ""}
        </span>
      </Stat>
      <Stat label="Apply kits" value={String(activity.kits)}>
        <span>
          {activity.kits > 0
            ? `${formatCost(activity.costs.kits / activity.kits)} each on average`
            : "None yet this month"}
        </span>
      </Stat>
    </dl>
  );
}

function Stat({
  label,
  value,
  unit,
  children,
}: {
  label: string;
  value: string;
  unit?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(card, "flex flex-col gap-1 p-4")}>
      <dt className="text-[0.8125rem] font-medium text-muted-foreground">
        {label}
      </dt>
      <dd className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </span>
        {unit ? (
          <span className="text-sm text-muted-foreground">{unit}</span>
        ) : null}
      </dd>
      <dd className="mt-auto flex flex-col gap-2.5 pt-2 text-xs text-muted-foreground">
        {children}
      </dd>
    </div>
  );
}

function PaceVerdict({
  pace,
  spent,
  limit,
}: {
  pace: number | null;
  spent: number;
  limit: number;
}) {
  const budget = formatBudget(limit);
  const verdict: { tone?: string; Icon?: LucideIcon; text: string } =
    spent >= limit
      ? {
          tone: "text-destructive-ink",
          Icon: CircleAlertIcon,
          text: "The budget is spent",
        }
      : pace === null
        ? { text: "Too early to tell" }
        : pace > limit
          ? {
              tone: "text-warning-ink",
              Icon: TriangleAlertIcon,
              text: `Over your ${budget} budget`,
            }
          : pace > 0.8 * limit
            ? {
                tone: "text-warning-ink",
                Icon: TriangleAlertIcon,
                text: `Close to your ${budget} budget`,
              }
            : {
                tone: "text-success-ink",
                Icon: CheckIcon,
                text: `${pace > 0.5 * limit ? "Under" : "Well under"} your ${budget} budget`,
              };
  const { tone, Icon, text } = verdict;
  return (
    <span className={cn("flex items-center gap-1.5 font-medium", tone)}>
      {Icon ? <Icon aria-hidden className="size-3.5 shrink-0" /> : null}
      {text}
    </span>
  );
}

/** Each day's spend this month as a bar, split by group of steps. */
export function SpendPerDay({
  spend,
  now,
}: {
  spend: SpendSummary;
  now: Date;
}) {
  const month = monthName(spend.monthStart);
  const today = now.toISOString().slice(0, 10);
  const daysSoFar = spend.days.filter((day) => day.day <= today).length;
  const average = daysSoFar > 0 ? spend.monthSpendUsd / daysSoFar : 0;
  const spentDays = spend.days.filter((day) => dayTotal(day) > 0);

  return (
    <section
      aria-labelledby="per-day-heading"
      className={cn(card, "p-4 sm:p-5")}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="per-day-heading" className="text-[0.9375rem] font-semibold">
          Spend per day in {month}
        </h2>
        {average > 0 ? (
          <p className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
            <span
              aria-hidden
              className="w-3.5 border-t border-dashed border-foreground/45"
            />
            About {formatCost(average)} a day
          </p>
        ) : null}
      </div>

      {spentDays.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          No Claude calls this month yet. Searches, CV reads and tailoring show
          up here by day.
        </p>
      ) : (
        <>
          <SpendPerDayChart
            days={spend.days}
            today={today}
            average={average}
            className="mt-4"
          />
          <div className="sr-only">
            <table>
              <caption>
                Spend per day in {month}, days with Claude calls
              </caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  {GROUPS.map((group) => (
                    <th key={group} scope="col">
                      {SPEND_GROUPS[group].label}
                    </th>
                  ))}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {spentDays.map((day) => (
                  <tr key={day.day}>
                    <th scope="row">{shortDay(day.day)}</th>
                    {GROUPS.map((group) => (
                      <td key={group}>{formatCost(day[group])}</td>
                    ))}
                    <td>{formatCost(dayTotal(day))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

const shortModel = (model: string) => modelName(model).replace(/^Claude /, "");

/** This month's steps, grouped as the charts group them. */
export function stepRows(stages: StageCost[]): StepRow[] {
  return GROUPS.flatMap((group) =>
    stages
      .filter((stage) =>
        (STAGE_GROUPS[group] as readonly string[]).includes(stage.stage),
      )
      .map((stage) => ({
        key: `${stage.stage}-${stage.model}`,
        group,
        label: LLM_STAGE_LABELS[stage.stage].label,
        model: shortModel(stage.model),
        detail: `${modelName(stage.model)}${stage.stage === "score" ? ", half-price batch" : ""}`,
        costUsd: stage.costUsd,
        calls: stage.calls,
      })),
  );
}

/** This month's cost of each step, grouped as the chart groups them. */
export function CostByStep({ spend }: { spend: SpendSummary }) {
  const steps = stepRows(spend.stages);
  const groups = GROUPS.filter((group) =>
    steps.some((step) => step.group === group),
  ).map((group) => ({
    group,
    costUsd: steps
      .filter((step) => step.group === group)
      .reduce((sum, step) => sum + step.costUsd, 0),
  }));
  const month = monthName(spend.monthStart);

  return (
    <section
      aria-labelledby="by-step-heading"
      className={cn(card, "flex flex-col")}
    >
      <div className="px-4 pt-4 pb-3 sm:px-5">
        <h2 id="by-step-heading" className="text-[0.9375rem] font-semibold">
          Cost by step
        </h2>
        <p className="text-[0.8125rem] text-muted-foreground">
          {month} so far. Pick the model for each step in{" "}
          <Link
            href="/settings"
            className="text-primary-ink underline underline-offset-4"
          >
            Settings
          </Link>
          .
        </p>
      </div>
      {steps.length === 0 ? (
        <p className="px-4 pb-5 text-sm text-muted-foreground sm:px-5">
          No Claude calls this month yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3 px-4 pb-4 sm:px-5">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {groups.map(({ group, costUsd }) => (
              <li key={group} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2 rounded-xs"
                  style={{ backgroundColor: SPEND_GROUPS[group].color }}
                />
                {SPEND_GROUPS[group].label}
                <span className="font-semibold text-foreground tabular-nums">
                  {formatCost(costUsd)}
                </span>
              </li>
            ))}
          </ul>
          <CostByStepChart steps={steps} />
          <div className="sr-only">
            <table>
              <caption>{month}&apos;s cost by step</caption>
              <thead>
                <tr>
                  <th scope="col">Step</th>
                  <th scope="col">Model</th>
                  <th scope="col">Cost</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step) => (
                  <tr key={step.key}>
                    <th scope="row">{step.label}</th>
                    <td>{step.detail}</td>
                    <td>{formatCost(step.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-3 border-t bg-muted/40 px-4 py-3 sm:px-5">
        {spend.stages.length > 0 ? (
          <TokensDialog
            description={`${month}'s Claude calls by step and model, with the tokens they used.`}
          >
            <StageCostTable
              stages={spend.stages}
              caption={`${month}'s Claude calls by step`}
            />
          </TokensDialog>
        ) : (
          <span />
        )}
        <p className="flex items-baseline gap-2 text-sm text-muted-foreground">
          Total
          <span className="text-base font-semibold text-foreground tabular-nums">
            {formatCost(spend.monthSpendUsd)}
          </span>
        </p>
      </div>
    </section>
  );
}

const monthAndYear = (month: string) =>
  new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));

/** What earlier months cost, newest first. */
export function EarlierMonths({ spend }: { spend: SpendSummary }) {
  const earlier = spend.months.filter(
    (entry) => entry.month !== spend.monthStart.slice(0, 7),
  );
  if (earlier.length === 0) return null;
  return (
    <section aria-labelledby="earlier-heading" className={cn(card, "py-1")}>
      <h2
        id="earlier-heading"
        className="px-4 pt-3 pb-1 text-[0.9375rem] font-semibold sm:px-5"
      >
        Earlier months
      </h2>
      <ul>
        {earlier.map((entry) => (
          <li
            key={entry.month}
            className="flex items-baseline justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-b-0 sm:px-5"
          >
            <span>{monthAndYear(entry.month)}</span>
            <span className="text-muted-foreground tabular-nums">
              {entry.calls === 1 ? "1 call" : `${entry.calls} calls`}
              <span className="ml-3 font-semibold text-foreground">
                {formatCost(entry.costUsd)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
