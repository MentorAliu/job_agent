import { describe, expect, it } from "vitest";

import {
  decodeEntities,
  htmlToText,
  MAX_PAGE_CHARS,
  pageText,
} from "./page-text";

describe("htmlToText", () => {
  it("keeps line breaks and list items, and drops scripts and styles", () => {
    const html = `<html><head><title>x</title><style>p{}</style></head><body>
      <h1>Senior Frontend Engineer</h1>
      <p>Remote &amp; flexible &ndash; anywhere in <b>Europe</b>.</p>
      <ul><li>React</li><li>TypeScript</li></ul>
      <script>alert("hi")</script>
    </body></html>`;
    expect(htmlToText(html)).toBe(
      "Senior Frontend Engineer\n\nRemote & flexible – anywhere in Europe.\n\n- React\n\n- TypeScript",
    );
  });

  it("decodes numeric references and leaves unknown ones", () => {
    expect(decodeEntities("It&#39;s &#x2014; &bogus; &#0;")).toBe(
      "It's — &bogus; &#0;",
    );
  });
});

describe("pageText", () => {
  const ld = (posting: object) =>
    `<script type="application/ld+json">${JSON.stringify(posting)}</script>`;

  it("puts the posting's JSON-LD facts first", () => {
    const html = `<html><body>${ld({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "Ignored" },
        {
          "@type": "JobPosting",
          title: "Frontend Engineer",
          hiringOrganization: { "@type": "Organization", name: "Northwind" },
          datePosted: "2026-10-20",
          jobLocationType: "TELECOMMUTE",
          applicantLocationRequirements: [
            { "@type": "Country", name: "Germany" },
            { "@type": "Country", name: "Montenegro" },
          ],
          baseSalary: {
            "@type": "MonetaryAmount",
            currency: "EUR",
            value: { minValue: 60000, maxValue: 80000, unitText: "YEAR" },
          },
          description: "&lt;p&gt;Short&lt;/p&gt;",
        },
      ],
    })}<main><p>${"We build React apps for freight teams. ".repeat(5)}</p></main></body></html>`;
    const text = pageText(html);
    expect(text.split("\n\n")[0]).toBe(
      [
        "Title: Frontend Engineer",
        "Company: Northwind",
        "Posted: 2026-10-20",
        "Location type: TELECOMMUTE",
        "Applicants must be in: Germany; Montenegro",
        "Salary: 60000–80000 EUR YEAR",
      ].join("\n"),
    );
    expect(text).toContain("We build React apps for freight teams.");
    expect(text).not.toContain("Short");
  });

  it("uses the JSON-LD description when the page itself shows little", () => {
    const html = `<html><body><div id="app"></div>${ld({
      "@type": "JobPosting",
      title: "Frontend Engineer",
      description: `<p>${"Work on our design system in React. ".repeat(10)}</p><ul><li>Vue is a plus</li></ul>`,
    })}</body></html>`;
    const text = pageText(html);
    expect(text).toContain("Work on our design system in React.");
    expect(text).toContain("- Vue is a plus");
  });

  it("is the visible text when there's no JSON-LD, cut to the cap", () => {
    expect(pageText("<p>Hello <i>there</i></p>")).toBe("Hello there");
    expect(pageText(`<p>${"a".repeat(MAX_PAGE_CHARS + 10)}</p>`)).toHaveLength(
      MAX_PAGE_CHARS,
    );
  });

  it("ignores JSON-LD that doesn't parse", () => {
    expect(
      pageText(
        '<script type="application/ld+json">{oops</script><p>Posting</p>',
      ),
    ).toBe("Posting");
  });
});
