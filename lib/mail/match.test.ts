import { describe, expect, it } from "vitest";

import { rolesNamedIn } from "./match";

const roles = [
  { id: "1", company: "Prezly" },
  { id: "2", company: "Northwind Labs GmbH" },
  { id: "3", company: "Ramp" },
];

describe("rolesNamedIn", () => {
  it("finds a company named anywhere in the email, ignoring case and suffixes", () => {
    const text =
      "Hi Jordan,\nThanks for applying to NORTHWIND LABS.\n\nDana, Talent team";
    expect(rolesNamedIn(text, roles).map((role) => role.id)).toEqual(["2"]);
  });

  it("matches whole words only", () => {
    expect(
      rolesNamedIn("We're ramping up hiring at Prezlyworks", roles),
    ).toEqual([]);
    expect(
      rolesNamedIn("The team at Prezly would like to talk.", roles).map(
        (role) => role.id,
      ),
    ).toEqual(["1"]);
  });

  it("returns every company the email names", () => {
    expect(
      rolesNamedIn("Ramp and Prezly both use our hiring tool.", roles).map(
        (role) => role.id,
      ),
    ).toEqual(["1", "3"]);
  });
});
