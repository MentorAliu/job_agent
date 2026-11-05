// pdf.js ships no types for its worker module, which the server loads to
// read a PDF's text on its own thread (see extractPdfText).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
