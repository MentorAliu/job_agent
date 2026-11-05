// A stored file as a Route Handler sends it: a tailored PDF or the CV the
// owner uploaded. It always downloads when opened directly, and the browser
// never guesses another type from its bytes. The in-app viewer reads the
// same response with fetch, so it shows exactly the file that downloads.

export type StoredFile = {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  filename: string;
};

export function fileResponse({ bytes, mime, filename }: StoredFile): Response {
  return new Response(bytes, {
    headers: {
      "content-type": mime,
      "content-length": String(bytes.byteLength),
      "content-disposition": contentDisposition(filename),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** An ASCII fallback name, and the real one for browsers that read it. */
function contentDisposition(filename: string): string {
  const ascii = filename.normalize("NFKD").replace(/[^\x20-\x7e]|["\\]/g, "");
  // encodeURIComponent leaves ' ( ) * as they are, which RFC 5987 doesn't allow.
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
