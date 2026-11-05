import { describe, expect, it } from "vitest";

import { placeName, timeZoneGroups } from "./time-zones";

describe("placeName", () => {
  it("drops the region and reads like a place", () => {
    expect(placeName("Europe/Belgrade")).toBe("Belgrade");
    expect(placeName("America/New_York")).toBe("New York");
    expect(placeName("America/Argentina/Buenos_Aires")).toBe(
      "Argentina / Buenos Aires",
    );
    expect(placeName("UTC")).toBe("UTC");
  });
});

describe("timeZoneGroups", () => {
  it("groups by region, A to Z, with names without one last", () => {
    const groups = timeZoneGroups(
      ["Europe/Lisbon", "Africa/Accra", "Europe/Belgrade"],
      ["UTC"],
    );
    expect(groups).toEqual([
      { region: "Africa", zones: [{ value: "Africa/Accra", label: "Accra" }] },
      {
        region: "Europe",
        zones: [
          { value: "Europe/Belgrade", label: "Belgrade" },
          { value: "Europe/Lisbon", label: "Lisbon" },
        ],
      },
      { region: "Other", zones: [{ value: "UTC", label: "UTC" }] },
    ]);
  });

  it("adds a saved name the list lacks, once", () => {
    const groups = timeZoneGroups(
      ["Asia/Calcutta"],
      ["Asia/Kolkata", "Asia/Calcutta", null],
    );
    expect(groups).toEqual([
      {
        region: "Asia",
        zones: [
          { value: "Asia/Calcutta", label: "Calcutta" },
          { value: "Asia/Kolkata", label: "Kolkata" },
        ],
      },
    ]);
  });
});
