import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/dal/db", () => ({ db: {} }));
vi.mock("@/lib/storage", () => ({ getStorage: () => ({}) }));

const { extractPdfText } = await import("./cv");

describe("extractPdfText", () => {
  it("reads a PDF CV's text, line by line", async () => {
    const pdf = await renderToBuffer(
      createElement(
        Document,
        null,
        createElement(
          Page,
          null,
          createElement(Text, null, "Jordan Sample, Senior Frontend Engineer"),
          createElement(
            Text,
            null,
            "Northwind Analytics, React and TypeScript",
          ),
        ),
      ),
    );
    const text = await extractPdfText(new Uint8Array(pdf));
    expect(text).toContain("Jordan Sample, Senior Frontend Engineer");
    expect(text).toContain("Northwind Analytics, React and TypeScript");
  });

  it("gives null for a file that isn't a PDF", async () => {
    expect(
      await extractPdfText(new TextEncoder().encode("not a pdf")),
    ).toBeNull();
  });
});
