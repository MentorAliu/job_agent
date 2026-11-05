"use client";

import dynamic from "next/dynamic";

import { Spinner } from "@/components/ui/spinner";

// The app's PDF viewer in the page itself, rather than in a window. PDF.js
// loads only once this shows.
const PdfViewer = dynamic(
  () => import("./pdf-viewer").then((module) => module.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="grid flex-1 place-items-center bg-muted">
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner aria-hidden />
          Opening the PDF…
        </p>
      </div>
    ),
  },
);

/** A stored PDF shown inline, with the viewer's own zoom and Download. */
export function PdfPreview({ url, title }: { url: string; title: string }) {
  return (
    <div className="flex h-[min(80dvh,56rem)] min-h-96 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
      <PdfViewer url={url} title={title} />
    </div>
  );
}
