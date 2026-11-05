import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";

import { relations } from "@/db/relations";
import type { WantedFocus } from "@/lib/schemas/profile";

import {
  DEFAULT_JOB_LIST_PARAMS,
  JOB_SORTS,
  loadJobListParams,
  type JobListParams,
} from "./list-params";
import { buildJobListQuery, escapeLike } from "./list-query";

// The queries are built with a Drizzle client that has no connection, and
// checked as the SQL text and parameters Postgres would receive.
const db = drizzle.mock({ relations });
const TODAY = "2026-10-18";
const CLOCK = { timeZone: "Europe/Lisbon", today: TODAY };

function build(
  overrides: Partial<JobListParams> = {},
  wanted: WantedFocus = "frontend",
) {
  const query = buildJobListQuery(
    db,
    { ...DEFAULT_JOB_LIST_PARAMS, ...overrides },
    CLOCK,
    { wanted },
  );
  return { rows: query.rows.toSQL(), counts: query.counts.toSQL() };
}

const DUE =
  '(("job"."follow_up_on" <= $1) and ("job"."status" not in ($2, $3, $4, $5, $6, $7, $8)))';
const DUE_PARAMS = [
  TODAY,
  "rejected",
  "no_response",
  "withdrawn",
  "skipped",
  "not_eligible",
  "listing_closed",
  "removed",
];

/** The SQL with whitespace collapsed, for readable assertions. */
const flat = (sql: string) => sql.replace(/\s+/g, " ");

describe("buildJobListQuery", () => {
  it("pages, sorts and counts in SQL with no filters by default", () => {
    const { rows, counts } = build();
    const sql = flat(rows.sql);

    // No WHERE: the join goes straight to the ORDER BY.
    expect(sql).toContain(
      'from "job" left join "application" on "application"."job_id" = "job"."id" order by',
    );
    expect(sql).toContain(
      'order by "job"."found_at" desc nulls last, "job"."found_at" desc, "job"."id" asc',
    );
    // Drizzle leaves out OFFSET 0.
    expect(sql).toMatch(/ asc limit \$1$/);
    expect(rows.params).toEqual([25]);

    // Without a cut-off for New, nothing is New.
    expect(flat(counts.sql)).toBe(
      `select "status", count(*), count(*) filter (where ${DUE}), 0 from "job" group by "job"."status"`,
    );
    expect(counts.params).toEqual(DUE_PARAMS);
  });

  it("dates each role's status from its timeline, or from when it was found", () => {
    expect(flat(build().rows.sql)).toContain(
      `coalesce( (select max("event"."at") from "event" where "event"."job_id" = "job"."id" and "event"."type" in ('status_changed', 'documents_ready')), "job"."found_at" )`,
    );
  });

  it("turns the page number and size into LIMIT and OFFSET", () => {
    const { rows } = build({ page: 3, size: 50 });
    expect(flat(rows.sql)).toMatch(/ limit \$1 offset \$2$/);
    expect(rows.params).toEqual([50, 150]);
  });

  it("filters by text, status, eligibility and score", () => {
    const { rows } = build({
      q: "  50%_off  ",
      status: ["shortlisted", "applied"],
      eligibility: ["eligible"],
      minScore: 70,
    });
    const where =
      '(((("job"."company" ilike $1) or ("job"."title" ilike $2))) and ("job"."status" in ($3, $4)) and ("job"."eligibility" in ($5)) and ("job"."score" >= $6))';

    expect(flat(rows.sql)).toContain(`where ${where} order by`);
    expect(rows.params).toEqual([
      "%50\\%\\_off%",
      "%50\\%\\_off%",
      "shortlisted",
      "applied",
      "eligible",
      70,
      25,
    ]);
  });

  it("counts each status with every filter but the status", () => {
    const { counts } = build({
      q: "acme",
      status: ["applied"],
      eligibility: ["eligible"],
    });
    expect(flat(counts.sql)).toBe(
      `select "status", count(*), count(*) filter (where ${DUE}), 0 from "job" where (((("job"."company" ilike $9) or ("job"."title" ilike $10))) and ("job"."eligibility" in ($11))) group by "job"."status"`,
    );
    expect(counts.params).toEqual([
      ...DUE_PARAMS,
      "%acme%",
      "%acme%",
      "eligible",
    ]);
  });

  it("keeps postings that give a salary", () => {
    const { rows, counts } = build({ salary: true });
    const salary = `("job"."facts" #>> '{salary,min}' is not null or "job"."facts" #>> '{salary,max}' is not null)`;
    expect(flat(rows.sql)).toContain(`where ${salary} order by`);
    expect(flat(counts.sql)).toContain(`from "job" where ${salary} group by`);
  });

  it("counts New roles whatever the New filter, and lists only them with it", () => {
    const since = new Date("2026-10-18T21:00:00Z");
    const query = buildJobListQuery(
      db,
      { ...DEFAULT_JOB_LIST_PARAMS, foundAfter: since },
      CLOCK,
      { newSince: since },
    );
    const rows = query.rows.toSQL();
    const counts = query.counts.toSQL();
    expect(flat(rows.sql)).toContain('where "job"."found_at" > $1 order by');
    expect(rows.params[0]).toBe(since.toISOString());

    // The tab counts take the filter in a FILTER; the New count ignores it,
    // and the WHERE leaves it out so both see every role.
    expect(flat(counts.sql)).toBe(
      `select "status", count(*) filter (where "job"."found_at" > $1), count(*) filter (where ${DUE.replaceAll(/\$(\d+)/g, (_, n: string) => `$${Number(n) + 1}`)}), count(*) filter (where "job"."found_at" > $10) from "job" group by "job"."status"`,
    );
    expect(counts.params).toEqual([
      since.toISOString(),
      ...DUE_PARAMS,
      since.toISOString(),
    ]);
  });

  it("counts a follow-up as due from its day on, unless the role is closed", () => {
    const { rows, counts } = build({ followUp: "due" });
    expect(flat(rows.sql)).toContain(`where ${DUE} order by`);
    expect(rows.params).toEqual([...DUE_PARAMS, 25]);
    // The follow-up filter counts in a FILTER, so the "Follow-up due" count
    // stays the same whether it's on or off.
    expect(flat(counts.sql)).toBe(
      `select "status", count(*) filter (where ${DUE}), count(*) filter (where (("job"."follow_up_on" <= $9) and ("job"."status" not in ($10, $11, $12, $13, $14, $15, $16)))), 0 from "job" group by "job"."status"`,
    );

    expect(flat(build({ followUp: "set" }).rows.sql)).toContain(
      'where ("job"."follow_up_on" is not null) order by',
    );
    expect(flat(build({ followUp: "none" }).counts.sql)).toContain(
      'count(*) filter (where ("job"."follow_up_on" is null))',
    );
  });

  it.each([
    ["found", '"job"."found_at"'],
    ["score", '"job"."score"'],
    ["company", 'lower("job"."company")'],
    ["title", 'lower("job"."title")'],
    ["status", '"job"."status"'],
    ["applied", '"application"."applied_at"'],
    ["followUp", '"job"."follow_up_on"'],
  ] as const)("sorts by %s in the database", (sort, expression) => {
    expect(flat(build({ sort, dir: "asc" }).rows.sql)).toContain(
      `order by ${expression} asc nulls last,`,
    );
    expect(flat(build({ sort, dir: "desc" }).rows.sql)).toContain(
      `order by ${expression} desc nulls last,`,
    );
  });

  it("sorts by the day a posting went up, or else the day it was found", () => {
    const { rows } = build({ sort: "posted" });
    expect(flat(rows.sql)).toContain(
      `order by coalesce("job"."posted_on", ("job"."found_at" at time zone $1)::date) desc nulls last, "job"."found_at" desc`,
    );
    // The owner's time zone, for the day a role was found.
    expect(rows.params[0]).toBe("Europe/Lisbon");
  });

  it("sorts in the order kits go: frontend, then the newest, then the best", () => {
    const { rows } = build({ status: ["new"], sort: "priority", dir: "asc" });
    // Whatever the direction.
    expect(flat(rows.sql)).toContain(
      `order by "job"."score" is null, case "job"."focus" when 'frontend' then 0 when 'fullstack' then 1 else 2 end, case when "job"."posted_on" is null then $2 else greatest($3::date - "job"."posted_on", 0) end, "job"."score" desc nulls last, "job"."found_at" desc, "job"."id" asc`,
    );
    expect(rows.params.slice(0, 3)).toEqual(["new", 7, TODAY]);
  });

  it("puts the kind of role wanted first, or none when any will do", () => {
    const sort: Partial<JobListParams> = { status: ["new"], sort: "priority" };
    expect(flat(build(sort, "backend").rows.sql)).toContain(
      `order by "job"."score" is null, case "job"."focus" when 'fullstack' then 1 when 'backend' then 0 else 2 end, case when`,
    );
    expect(flat(build(sort, "any").rows.sql)).toContain(
      `order by "job"."score" is null, case when "job"."posted_on" is null`,
    );
  });

  it("sorts salaries as yearly amounts", () => {
    const sql = flat(build({ sort: "salary" }).rows.sql);
    expect(sql).toContain(
      `order by coalesce( ("job"."facts" #>> '{salary,max}')::numeric, ("job"."facts" #>> '{salary,min}')::numeric ) * case "job"."facts" #>> '{salary,period}' when 'month' then 12`,
    );
    expect(sql).toContain("end desc nulls last,");
  });

  it("has an ORDER BY for every sort the URL accepts", () => {
    for (const sort of JOB_SORTS) {
      expect(flat(build({ sort }).rows.sql)).toMatch(
        / order by .+ desc nulls last, "job"\."found_at" desc, "job"\."id" asc limit/,
      );
    }
  });

  it("builds the same query from a URL as from the parsed values", () => {
    const fromUrl = buildJobListQuery(
      db,
      loadJobListParams(
        "http://localhost/api/jobs?status=new&sort=score&page=2&size=50",
      ),
      CLOCK,
    ).rows.toSQL();
    expect(fromUrl).toEqual(
      build({ status: ["new"], sort: "score", page: 1, size: 50 }).rows,
    );
  });
});

describe("escapeLike", () => {
  it("makes %, _ and backslash match themselves", () => {
    expect(escapeLike("100% a_b\\c")).toBe("100\\% a\\_b\\\\c");
  });
});
