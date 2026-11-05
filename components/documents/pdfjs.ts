// Mozilla's PDF.js, loaded the first time a PDF is shown, with one worker
// for the page's lifetime that the viewer and every preview share. The
// worker is served by the app itself.

export type Lib = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
export type Components =
  typeof import("pdfjs-dist/legacy/web/pdf_viewer.mjs");

type PdfLib = {
  lib: Lib;
  /** One worker for the page's lifetime, shared by every PDF opened. */
  worker: InstanceType<Lib["PDFWorker"]>;
};

let pdfLib: Promise<PdfLib> | null = null;
let viewerComponents: Promise<Components> | null = null;

/** Loads the library and starts its worker, once. */
export function loadPdfLib(): Promise<PdfLib> {
  pdfLib ??= importPdfLib().catch((error: unknown) => {
    pdfLib = null; // The next PDF shown tries again.
    throw error;
  });
  return pdfLib;
}

async function importPdfLib(): Promise<PdfLib> {
  // The legacy build runs in browsers a few versions old as well.
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = lib.PDFWorker.create({
    port: new Worker(
      new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url),
      { type: "module" },
    ),
  });
  return { lib, worker };
}

/** The library with its viewer, for a PDF opened to read. */
export async function loadPdfJs(): Promise<PdfLib & { components: Components }> {
  // The viewer reads the library from globalThis, so the library loads first.
  const base = await loadPdfLib();
  viewerComponents ??= import("pdfjs-dist/legacy/web/pdf_viewer.mjs").catch(
    (error: unknown) => {
      viewerComponents = null;
      throw error;
    },
  );
  return { ...base, components: await viewerComponents };
}
