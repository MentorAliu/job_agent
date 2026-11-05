import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SpendSummary, StageCost } from "@/lib/dal/spend";

import { chartScale, formatTick } from "./spend-chart-config";
import { CostByStep, stepRows } from "./spend-overview";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function stage(
  name: StageCost["stage"],
  model: string,
  costUsd: number,
): StageCost {
  return {
    stage: name,
    model,
    calls: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearches: 0,
    costUsd,
  };
}

describe("chartScale", () => {
  it("picks round steps a little above the busiest day", () => {
    expect(chartScale(0.33)).toEqual({ top: 0.4, ticks: [0.1, 0.2, 0.3, 0.4] });
    expect(chartScale(0.078)).toEqual({
      top: 0.08,
      ticks: [0.02, 0.04, 0.06, 0.08],
    });
    expect(chartScale(2.4)).toEqual({ top: 3, ticks: [1, 2, 3] });
    expect(chartScale(0.2)).toEqual({
      top: 0.2,
      ticks: [0.05, 0.1, 0.15, 0.2],
    });
  });

  it("draws no lines when nothing was spent", () => {
    expect(chartScale(0)).toEqual({ top: 1, ticks: [] });
  });
});

describe("formatTick", () => {
  it("shows cents, a third decimal only when needed, and $0 at the baseline", () => {
    expect(formatTick(0.1)).toBe("$0.10");
    expect(formatTick(0.025)).toBe("$0.025");
    expect(formatTick(0)).toBe("$0");
  });
});

const stages = [
  stage("discover", "claude-haiku-5-5", 1.12),
  stage("tailor", "claude-sonnet-5-5", 0.46),
  stage("score", "claude-haiku-5-5", 0.13),
  stage("parse_cv", "claude-sonnet-5-5", 0.04),
];

describe("stepRows", () => {
  it("orders the steps by group, as the charts stack them", () => {
    expect(
      stepRows(stages).map(({ key, group, model, detail }) => ({
        key,
        group,
        model,
        detail,
      })),
    ).toEqual([
      {
        key: "discover-claude-haiku-5-5",
        group: "searching",
        model: "Haiku 5.5",
        detail: "Claude Haiku 5.5",
      },
      {
        key: "score-claude-haiku-5-5",
        group: "searching",
        model: "Haiku 5.5",
        detail: "Claude Haiku 5.5, half-price batch",
      },
      {
        key: "tailor-claude-sonnet-5-5",
        group: "kits",
        model: "Sonnet 5.5",
        detail: "Claude Sonnet 5.5",
      },
      {
        key: "parse_cv-claude-sonnet-5-5",
        group: "cv",
        model: "Sonnet 5.5",
        detail: "Claude Sonnet 5.5",
      },
    ]);
  });
});

describe("CostByStep", () => {
  it("totals each group and lists every step for screen readers", () => {
    const spend: SpendSummary = {
      limits: { monthlyUsd: 20, runUsd: 1 },
      monthStart: "2026-10-01T00:00:00.000Z",
      monthSpendUsd: 1.75,
      stages,
      days: [],
      months: [],
    };
    const html = text(renderToStaticMarkup(<CostByStep spend={spend} />));
    expect(html).toContain("Searching $1.25 Apply kits $0.46 CVs $0.040");
    expect(html).toContain(
      "Search job boards Claude Haiku 5.5 $1.12 Score matches Claude Haiku 5.5, half-price batch $0.13 Tailor documents Claude Sonnet 5.5 $0.46 Read CV Claude Sonnet 5.5 $0.040",
    );
    expect(html).toContain("Total $1.75");
  });
});
