import { eq, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";

import { relations } from "@/db/relations";
import { llmCall } from "@/db/schema";

vi.mock("./db", () => ({ db: {} }));
vi.mock("./session", () => ({ getCurrentUser: async () => ({ id: "u1" }) }));

const {
  dailySpendQuery,
  monthCallsQuery,
  monthDays,
  monthlySpendQuery,
  monthRunsQuery,
  monthStart,
  spendByStageQuery,
  stageCostQuery,
} = await import("./spend");

// Built with a Drizzle client that has no connection, and checked as the
// SQL text and parameters Postgres would receive.
const db = drizzle.mock({ relations });
const flat = (sql: string) => sql.replace(/\s+/g, " ");
const RUN_ID = "7d0c1a52-6f1e-4d6b-9a83-0f2b2b6f9d11";

describe("stageCostQuery", () => {
  it("sums tokens and cost per stage and model, costliest first", () => {
    const query = stageCostQuery(db, eq(llmCall.runId, RUN_ID)).toSQL();
    const sql = flat(query.sql);
    expect(sql).toContain('coalesce(sum("cost_usd"), 0) from "llm_call"');
    expect(sql).toContain('select "stage", "model", count(*)');
    expect(sql).toContain('where "llm_call"."run_id" = $1');
    expect(sql).toContain(
      'group by "llm_call"."stage", "llm_call"."model" order by sum("llm_call"."cost_usd") desc',
    );
    expect(query.params).toEqual([RUN_ID]);
  });
});

describe("monthlySpendQuery", () => {
  it("groups calls by UTC calendar month, newest first", () => {
    const since = new Date("2026-05-01T00:00:00Z");
    const query = monthlySpendQuery(db, since).toSQL();
    const sql = flat(query.sql);
    expect(sql).toContain(
      `to_char(date_trunc('month', "llm_call"."created_at" at time zone 'UTC'), 'YYYY-MM')`,
    );
    expect(sql).toContain('where "llm_call"."created_at" >= $1');
    expect(sql).toMatch(/group by to_char\(.+\) order by to_char\(.+\) desc$/);
    expect(query.params).toHaveLength(1);
  });

  it("matches what the month's budget check counts", () => {
    expect(
      flat(stageCostQuery(db, gte(llmCall.createdAt, new Date())).toSQL().sql),
    ).toContain('where "llm_call"."created_at" >= $1');
  });
});

describe("monthStart", () => {
  it("is the first moment of the month in UTC", () => {
    const now = new Date("2026-10-18T00:30:00+02:00");
    expect(monthStart(now).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(monthStart(now, 5).toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(monthStart(new Date("2026-02-10T00:00:00Z"), 3).toISOString()).toBe(
      "2025-11-01T00:00:00.000Z",
    );
  });
});

describe("dailySpendQuery", () => {
  it("sums each UTC day's cost by group of steps, oldest first", () => {
    const query = dailySpendQuery(
      db,
      new Date("2026-10-01T00:00:00Z"),
    ).toSQL();
    const sql = flat(query.sql);
    expect(sql).toContain(
      `group by to_char("llm_call"."created_at" at time zone 'UTC', 'YYYY-MM-DD')`,
    );
    expect(sql).toContain(
      'coalesce(sum("cost_usd") filter (where "llm_call"."stage" in ($1, $2, $3)), 0)',
    );
    expect(sql).toMatch(/group by to_char\(.+\) order by to_char\(.+\)$/);
    expect(query.params.slice(0, 9)).toEqual([
      "discover",
      "extract",
      "score",
      "company_snapshot",
      "tailor",
      "claim_check",
      "parse_cv",
      "build_cv",
      "read_email",
    ]);
  });
});

describe("monthDays", () => {
  it("lists every day of the month, with nothing spent on days without calls", () => {
    const start = new Date("2026-10-01T00:00:00Z");
    const days = monthDays(start, [
      {
        day: "2026-10-18",
        searching: 0.21,
        kits: 0.08,
        cv: 0,
        email: 0,
        checks: 0,
      },
    ]);
    expect(days).toHaveLength(31);
    expect(days[0]).toEqual({
      day: "2026-10-01",
      searching: 0,
      kits: 0,
      cv: 0,
      email: 0,
      checks: 0,
    });
    expect(days[17]).toEqual({
      day: "2026-10-18",
      searching: 0.21,
      kits: 0.08,
      cv: 0,
      email: 0,
      checks: 0,
    });
    expect(days.at(-1)?.day).toBe("2026-10-31");
    expect(monthDays(new Date("2028-02-01T00:00:00Z"), [])).toHaveLength(29);
  });
});

describe("monthCallsQuery", () => {
  it("counts each role tailored this month once, however many calls it took", () => {
    const sql = flat(
      monthCallsQuery(db, new Date("2026-10-01T00:00:00Z")).toSQL().sql,
    );
    expect(sql).toContain(
      `count(distinct "job_id") filter (where "stage" = 'tailor')`,
    );
    expect(sql).toContain('where "llm_call"."created_at" >=');
  });
});

describe("monthRunsQuery", () => {
  it("counts the month's searches and the ones that failed or stopped", () => {
    const sql = flat(
      monthRunsQuery(db, new Date("2026-10-01T00:00:00Z")).toSQL().sql,
    );
    expect(sql).toContain(`count(*) filter (where "status" = 'failed')`);
    expect(sql).toContain(`count(*) filter (where "status" = 'stopped')`);
    expect(sql).toContain('where "run"."started_at" >= $1');
  });
});

describe("monthStart, a month ahead", () => {
  it("is when the budget resets", () => {
    expect(
      monthStart(new Date("2026-12-31T23:30:00Z"), -1).toISOString(),
    ).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("spendByStageQuery", () => {
  it("adds up each step's calls since the start of the month, whatever the model", () => {
    const query = spendByStageQuery(
      db,
      new Date("2026-10-01T00:00:00Z"),
    ).toSQL();
    const sql = flat(query.sql);
    expect(sql).toContain('select "stage", coalesce(sum("cost_usd"), 0)');
    expect(sql).toContain('where "llm_call"."created_at" >= $1');
    expect(sql).toMatch(/group by "llm_call"."stage"$/);
  });
});
