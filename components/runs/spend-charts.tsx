"use client";

import {
  Bar,
  BarChart,
  BarStack,
  CartesianGrid,
  LabelList,
  Rectangle,
  ReferenceLine,
  XAxis,
  YAxis,
  type BarShapeProps,
  type XAxisTickContentProps,
  type YAxisTickContentProps,
} from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { DaySpend } from "@/lib/dal/spend";
import type { StageGroup } from "@/lib/schemas/settings";
import { cn } from "@/lib/utils";

import { formatCost, shortDay } from "./run-labels";
import {
  chartScale,
  dayTotal,
  formatTick,
  GROUPS,
  SPEND_GROUPS,
  type StepRow,
} from "./spend-chart-config";

/** A day, with null for the groups that cost nothing so the tooltip skips them. */
type DayRow = { day: string } & Record<StageGroup, number | null>;

const rowTotal = (row: DayRow) =>
  GROUPS.reduce((sum, group) => sum + (row[group] ?? 0), 0);

/** The card-colored space between a day's parts, so neighbors read apart. */
const GAP = 2;

/**
 * One group's part of a day's bar. It stops short of the part below it by the
 * gap; BarStack rounds the top of the whole stack.
 */
function segmentShape(group: StageGroup) {
  const below = GROUPS.slice(0, GROUPS.indexOf(group));
  return function Segment({ x, y, width, height, payload }: BarShapeProps) {
    const row = payload as DayRow;
    const gap = below.some((other) => (row[other] ?? 0) > 0) ? GAP : 0;
    return (
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={Math.max(0, height - gap)}
        fill={`var(--color-${group})`}
      />
    );
  };
}

const SEGMENTS = Object.fromEntries(
  GROUPS.map((group) => [group, segmentShape(group)]),
) as Record<StageGroup, ReturnType<typeof segmentShape>>;

/** The day of the month: today's in bold, days still to come faded. */
function DayTick({
  x,
  y,
  payload,
  today,
}: XAxisTickContentProps & { today: string }) {
  const day = String(payload.value);
  return (
    <text
      x={x}
      y={y}
      dy="0.71em"
      textAnchor="middle"
      className={cn(
        "tabular-nums",
        day === today && "font-semibold fill-foreground!",
        day > today && "opacity-60",
      )}
    >
      {Number(day.slice(8))}
    </text>
  );
}

/** Each day's spend this month as a bar, split by group of steps. */
export function SpendPerDayChart({
  days,
  today,
  average,
  className,
}: {
  days: DaySpend[];
  /** The UTC day, as YYYY-MM-DD. */
  today: string;
  /** The average a day so far, drawn as a dashed line. */
  average: number;
  className?: string;
}) {
  const { top, ticks } = chartScale(Math.max(...days.map(dayTotal)));
  const rows = days.map(
    (day) =>
      ({
        day: day.day,
        ...Object.fromEntries(
          GROUPS.map((group) => [group, day[group] > 0 ? day[group] : null]),
        ),
      }) as DayRow,
  );

  return (
    <ChartContainer
      config={SPEND_GROUPS}
      className={cn("aspect-auto h-60 w-full", className)}
    >
      <BarChart
        accessibilityLayer
        data={rows}
        margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          interval="preserveStartEnd"
          minTickGap={6}
          tickFormatter={(day: string) => String(Number(day.slice(8)))}
          tick={(props) => <DayTick {...props} today={today} />}
        />
        <YAxis
          domain={[0, top]}
          ticks={[0, ...ticks]}
          tickFormatter={formatTick}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              className="min-w-44"
              labelFormatter={(day) => shortDay(String(day))}
              formatter={(value, name, item, index) => {
                const row = item.payload as DayRow;
                const shown = GROUPS.filter((group) => row[group] !== null);
                const group = name as StageGroup;
                return (
                  <>
                    <span
                      aria-hidden
                      className="w-1 shrink-0 self-stretch rounded-[2px]"
                      style={{ backgroundColor: SPEND_GROUPS[group].color }}
                    />
                    <span className="text-muted-foreground">
                      {SPEND_GROUPS[group].label}
                    </span>
                    <span className="ml-auto font-mono font-medium text-foreground tabular-nums">
                      {formatCost(Number(value))}
                    </span>
                    {shown.length > 1 && index === shown.length - 1 ? (
                      <span className="mt-0.5 flex basis-full items-center border-t pt-1.5 font-medium text-foreground">
                        Total
                        <span className="ml-auto font-mono tabular-nums">
                          {formatCost(rowTotal(row))}
                        </span>
                      </span>
                    ) : null}
                  </>
                );
              }}
            />
          }
        />
        {/* In stack order, bottom first, not sorted by name. On a phone the
            names wrap to a second row whole. */}
        <ChartLegend
          itemSorter={null}
          content={
            <ChartLegendContent className="flex-wrap gap-x-4 gap-y-1.5 *:whitespace-nowrap" />
          }
        />
        {average > 0 ? (
          <ReferenceLine
            y={average}
            stroke="var(--foreground)"
            strokeOpacity={0.45}
            strokeDasharray="4 4"
          />
        ) : null}
        <BarStack radius={[4, 4, 0, 0]}>
          {GROUPS.map((group) => (
            <Bar
              key={group}
              dataKey={group}
              fill={`var(--color-${group})`}
              maxBarSize={16}
              shape={SEGMENTS[group]}
            />
          ))}
        </BarStack>
      </BarChart>
    </ChartContainer>
  );
}

/** The step's name, with its model under it. */
function StepTick({
  x,
  y,
  step,
}: YAxisTickContentProps & { step: StepRow | undefined }) {
  if (!step) return null;
  return (
    <text x={x} y={y} textAnchor="end">
      <tspan x={x} dy="-0.35em" className="font-medium fill-foreground!">
        {step.label}
      </tspan>
      <tspan x={x} dy="1.3em">
        {step.model}
      </tspan>
    </text>
  );
}

/** This month's cost of each step, colored by its group. */
export function CostByStepChart({ steps }: { steps: StepRow[] }) {
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const data = steps.map((step) => ({
    ...step,
    fill: `var(--color-${step.group})`,
  }));

  return (
    <ChartContainer
      config={SPEND_GROUPS}
      className="aspect-auto w-full"
      style={{ height: steps.length * 44 }}
    >
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 52, bottom: 0, left: 0 }}
      >
        <XAxis type="number" dataKey="costUsd" domain={[0, "dataMax"]} hide />
        <YAxis
          type="category"
          dataKey="key"
          width={136}
          tickLine={false}
          axisLine={false}
          tick={(props) => (
            <StepTick
              {...props}
              step={byKey.get(String(props.payload.value))}
            />
          )}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, _name, item) => {
                const step = item.payload as StepRow;
                return (
                  <>
                    <span
                      aria-hidden
                      className="w-1 shrink-0 self-stretch rounded-[2px]"
                      style={{
                        backgroundColor: SPEND_GROUPS[step.group].color,
                      }}
                    />
                    <span className="flex flex-col gap-1">
                      <span className="font-medium text-foreground">
                        {step.label}
                      </span>
                      <span className="text-muted-foreground">
                        {step.detail}
                      </span>
                      <span className="text-muted-foreground">
                        {step.calls === 1 ? "1 call" : `${step.calls} calls`}
                      </span>
                    </span>
                    <span className="ml-auto pl-3 font-mono font-medium text-foreground tabular-nums">
                      {formatCost(Number(value))}
                    </span>
                  </>
                );
              }}
            />
          }
        />
        <Bar
          dataKey="costUsd"
          radius={[0, 4, 4, 0]}
          maxBarSize={12}
          minPointSize={2}
        >
          <LabelList
            dataKey="costUsd"
            position="right"
            offset={8}
            className="fill-foreground font-medium tabular-nums"
            formatter={(value) => formatCost(Number(value))}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
