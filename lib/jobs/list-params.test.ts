import { describe, expect, it } from "vitest";

import {
  DEFAULT_JOB_LIST_PARAMS,
  loadJobListParams,
  loadRolesParams,
  NEXT_UP_PARAMS,
  rolesListParams,
  serializeJobListParams,
  serializeRolesParams,
  tabSorts,
  viewSort,
} from "./list-params";

describe("the list's query string", () => {
  it("defaults to every role, newest first, 25 to a page", () => {
    expect(DEFAULT_JOB_LIST_PARAMS).toEqual({
      q: "",
      status: [],
      eligibility: [],
      minScore: null,
      salary: false,
      foundAfter: null,
      followUp: null,
      sort: "found",
      dir: "desc",
      page: 0,
      size: 25,
    });
    expect(serializeJobListParams("/api/jobs", DEFAULT_JOB_LIST_PARAMS)).toBe(
      "/api/jobs",
    );
  });

  it("reads filters, sort and a 1-based page, and writes them back the same", () => {
    const url =
      "/jobs?q=react&status=shortlisted,applied&eligibility=eligible&minScore=70&salary=true&foundAfter=2026-10-18T21:00:00.000Z&followUp=due&sort=score&dir=asc&page=3&size=50";
    const params = loadJobListParams(`http://localhost${url}`);
    expect(params).toEqual({
      q: "react",
      status: ["shortlisted", "applied"],
      eligibility: ["eligible"],
      minScore: 70,
      salary: true,
      foundAfter: new Date("2026-10-18T21:00:00.000Z"),
      followUp: "due",
      sort: "score",
      dir: "asc",
      page: 2,
      size: 50,
    });
    expect(
      loadJobListParams(
        `http://localhost${serializeJobListParams("/jobs", params)}`,
      ),
    ).toEqual(params);
  });

  it("falls back to defaults for values it doesn't know", () => {
    const params = loadJobListParams(
      "http://localhost/jobs?status=bogus&sort=password&dir=up&size=7&page=x",
    );
    expect(params).toEqual(DEFAULT_JOB_LIST_PARAMS);
  });

  it("ignores a page, score or search the database shouldn't get", () => {
    for (const query of [
      "page=0",
      "page=-3",
      "minScore=-5",
      "minScore=150",
      "minScore=99999999999",
      `q=${"a".repeat(201)}`,
    ]) {
      expect(loadJobListParams(`http://localhost/jobs?${query}`)).toEqual(
        DEFAULT_JOB_LIST_PARAMS,
      );
    }
    expect(loadRolesParams("http://localhost/jobs?page=0").page).toBe(0);
  });
});

describe("the Roles page's URL", () => {
  it("opens on the roles to send, ready kits first", () => {
    const view = loadRolesParams({});
    expect(view).toEqual({
      tab: "to_send",
      only: [],
      sort: null,
      page: 0,
    });
    expect(rolesListParams(view)).toMatchObject({
      status: ["shortlisted", "ready"],
      sort: "status",
      dir: "desc",
    });
    expect(serializeRolesParams("/jobs", view)).toBe("/jobs");
  });

  it("lists each tab's statuses", () => {
    const list = (tab: string) =>
      rolesListParams(loadRolesParams({ tab })).status;
    expect(list("waiting")).toEqual(["new"]);
    expect(list("passed")).toEqual([
      "skipped",
      "not_eligible",
      "listing_closed",
    ]);
    // All leaves out the roles the owner removed; they have their own tab.
    expect(list("all")).not.toContain("removed");
    expect(list("all")).toContain("applied");
    expect(list("removed")).toEqual(["removed"]);
    expect(list("bogus")).toEqual(["shortlisted", "ready"]);
  });

  it("keeps a 1-based page in the URL", () => {
    const view = loadRolesParams("http://localhost/jobs?tab=all&page=3");
    expect(rolesListParams(view)).toMatchObject({ page: 2, sort: "posted" });
    expect(serializeRolesParams("/jobs", view)).toBe("/jobs?tab=all&page=3");
  });

  it("turns the quick filters into list filters", () => {
    const since = new Date("2026-10-18T21:00:00Z");
    const view = loadRolesParams(
      "http://localhost/jobs?tab=all&only=new,strong,salary",
    );
    expect(view.only).toEqual(["new", "strong", "salary"]);
    expect(rolesListParams(view, since)).toMatchObject({
      minScore: 75,
      salary: true,
      foundAfter: since,
    });
    expect(rolesListParams(loadRolesParams({}), since)).toMatchObject({
      minScore: null,
      salary: false,
      foundAfter: null,
    });
    expect(serializeRolesParams("/jobs", view)).toBe(
      "/jobs?tab=all&only=new,strong,salary",
    );
    expect(loadRolesParams("http://localhost/jobs?only=bogus").only).toEqual(
      [],
    );
  });

  it("orders each tab its own way unless another order is picked", () => {
    expect(tabSorts("to_send")).toEqual(["ready", "best", "newest"]);
    expect(tabSorts("waiting")).toEqual(["next", "best", "newest"]);
    expect(tabSorts("all")).toEqual(["newest", "best"]);

    const order = (query: string) =>
      rolesListParams(loadRolesParams(`http://localhost/jobs?${query}`));
    // Newest: the newest postings, by the day they went up.
    expect(order("tab=all")).toMatchObject({ sort: "posted", dir: "desc" });
    expect(order("tab=all&sort=best")).toMatchObject({
      sort: "score",
      dir: "desc",
    });
    expect(order("sort=newest")).toMatchObject({ sort: "posted" });
    expect(order("tab=waiting")).toMatchObject({ sort: "priority" });
    // Ready first only fits the roles to send, and Next for a kit only
    // the roles waiting for one.
    expect(viewSort({ tab: "passed", sort: "ready" })).toBe("newest");
    expect(viewSort({ tab: "all", sort: "next" })).toBe("newest");
  });

  it("lists strong roles waiting for a kit, in the order kits go", () => {
    expect(NEXT_UP_PARAMS).toMatchObject({
      status: ["new"],
      minScore: 75,
      sort: "priority",
    });
  });
});
