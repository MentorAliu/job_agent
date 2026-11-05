import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";

import { relations } from "@/db/relations";

import {
  DEFAULT_APPLICATIONS_PARAMS,
  loadApplicationsParams,
  type ApplicationsParams,
} from "./params";
import { buildApplicationsQuery } from "./query";

// The queries are built with a Drizzle client that has no connection, and
// checked as the SQL text and parameters Postgres would receive.
const db = drizzle.mock({ relations });
const NOW = new Date("2026-10-20T09:00:00Z");

/** The SQL with whitespace collapsed, for readable assertions. */
const flat = (sql: string) => sql.replace(/\s+/g, " ");

function build(overrides: Partial<ApplicationsParams> = {}) {
  const query = buildApplicationsQuery(
    db,
    { ...DEFAULT_APPLICATIONS_PARAMS, ...overrides },
    NOW,
  );
  return { rows: query.rows.toSQL(), counts: query.counts.toSQL() };
}

const APPLIED = [
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "no_response",
  "withdrawn",
];
const YOUR_TURN =
  'coalesce("latest_email"."author" = \'employer\' and "latest_email"."reply_needed" and "latest_email"."handled_at" is null, false)';

describe("buildApplicationsQuery", () => {
  it("lists every application by its latest activity, with its newest email", () => {
    const { rows } = build();
    const sql = flat(rows.sql);

    // The newest email on each role that's about it, from one DISTINCT ON.
    expect(sql).toContain(
      'left join (select distinct on ("job_email"."job_id") "job_id", "id", "author", "outcome", "sure", "sender_name", "summary", "reply_needed", "handled_at", "created_at" from "job_email" where ((("job_email"."job_id" is not null)) and ("job_email"."status" = $4) and ("job_email"."outcome" <> $5)) order by "job_email"."job_id", "job_email"."created_at" desc) "latest_email" on "latest_email"."job_id" = "job"."id"',
    );
    expect(sql).toContain(
      'where "job"."status" in ($6, $7, $8, $9, $10, $11) order by greatest("latest_email"."created_at", "application"."applied_at") desc nulls last, "job"."found_at" desc, "job"."id" asc limit $12',
    );
    expect(rows.params).toEqual([
      "applied",
      "interviewing",
      "offer",
      "done",
      "unrelated",
      ...APPLIED,
      25,
    ]);
  });

  it("counts each stage over the same search, whatever the stage picked", () => {
    const { counts } = build({ stage: "closed" });
    const sql = flat(counts.sql);
    expect(sql).toMatch(/^select count\(\*\), count\(\*\) filter/);
    expect(sql).toContain(
      `count(*) filter (where ("job"."status" in ($4, $5, $6) and not ("job"."status" in ($7, $8, $9) and ${YOUR_TURN})))`,
    );
    expect(sql).toMatch(/where "job"\."status" in \(\$17, .+, \$22\)$/);
    expect(counts.params.slice(-6)).toEqual(APPLIED);
  });

  it("filters Your turn to open applications whose company is waiting on a reply", () => {
    const { rows } = build({ stage: "your_turn" });
    expect(flat(rows.sql)).toContain(
      `and (("job"."status" in ($12, $13, $14) and ${YOUR_TURN})))`,
    );
    expect(rows.params.slice(11, 14)).toEqual([
      "applied",
      "interviewing",
      "offer",
    ]);
  });

  it("searches company and title literally, and limits by the applied date", () => {
    const { rows } = build({ q: "50%_off", within: 30, page: 2 });
    const sql = flat(rows.sql);
    expect(sql).toContain(
      '(("job"."company" ilike $12) or ("job"."title" ilike $13))',
    );
    expect(sql).toContain('("application"."applied_at" >= $14)');
    expect(sql).toMatch(/limit \$15 offset \$16$/);
    expect(rows.params.slice(11)).toEqual([
      "%50\\%\\_off%",
      "%50\\%\\_off%",
      new Date("2026-09-20T09:00:00Z").toISOString(),
      25,
      50,
    ]);
  });
});

describe("loadApplicationsParams", () => {
  it("reads the URL, and falls back on values it doesn't know", () => {
    expect(
      loadApplicationsParams({
        stage: "your_turn",
        q: "  Prezly ",
        within: "30",
        page: "2",
      }),
    ).toEqual({ stage: "your_turn", q: "Prezly", within: 30, page: 1 });
    expect(loadApplicationsParams({ stage: "maybe", within: "12" })).toEqual(
      DEFAULT_APPLICATIONS_PARAMS,
    );
  });
});
