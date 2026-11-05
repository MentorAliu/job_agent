"use client";

import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export type FunnelStep = { key: string; label: string; value: number };

/**
 * One bar per step, as long as its count. The steps run from light to dark,
 * so the later ones stand out.
 */
export function FunnelBars({ steps }: { steps: FunnelStep[] }) {
  const found = steps[0]?.value ?? 0;
  const config: ChartConfig = Object.fromEntries(
    steps.map((step, index) => [
      step.key,
      { label: step.label, color: `var(--funnel-${index + 1})` },
    ]),
  );
  const data = steps.map((step) => ({
    ...step,
    fill: `var(--color-${step.key})`,
  }));

  return (
    <ChartContainer config={config} className="aspect-auto h-48 w-full">
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 36, bottom: 0, left: 0 }}
      >
        <XAxis
          type="number"
          dataKey="value"
          domain={[0, Math.max(1, found)]}
          hide
        />
        <YAxis
          type="category"
          dataKey="label"
          width={92}
          tickLine={false}
          axisLine={false}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, _name, item) => {
                const step = item.payload as (typeof data)[number];
                const isFirst = step.key === steps[0]?.key;
                return (
                  <>
                    <span
                      aria-hidden
                      className="w-1 shrink-0 self-stretch rounded-[2px]"
                      style={{ backgroundColor: step.fill }}
                    />
                    <span className="flex flex-col gap-1">
                      <span className="text-muted-foreground">
                        {step.label}
                      </span>
                      {!isFirst && found > 0 ? (
                        <span className="text-muted-foreground">
                          {Math.round((step.value / found) * 100)}% of found
                        </span>
                      ) : null}
                    </span>
                    <span className="ml-auto pl-3 font-mono font-medium text-foreground tabular-nums">
                      {Number(value)}
                    </span>
                  </>
                );
              }}
            />
          }
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={12}>
          <LabelList
            dataKey="value"
            position="right"
            offset={8}
            className="fill-foreground font-semibold tabular-nums"
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
