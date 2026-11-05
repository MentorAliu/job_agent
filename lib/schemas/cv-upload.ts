import { z } from "zod";

// Vercel Functions accept request bodies up to 4.5 MB, form encoding included.
export const MAX_CV_BYTES = 4 * 1024 * 1024;
export const CV_TOO_LARGE = "The file is larger than 4 MB.";

export const PDF_MIME = "application/pdf";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** For the file picker's `accept` attribute. */
export const CV_ACCEPT = `.pdf,.docx,${PDF_MIME},${DOCX_MIME}`;

export const cvUploadSchema = z.object({
  file: z
    .file({ error: "Choose a CV file to upload." })
    .min(1, "The file is empty.")
    .max(MAX_CV_BYTES, CV_TOO_LARGE),
});

/**
 * The CV's real type, from its first bytes rather than the browser's MIME
 * type, which is often missing for DOCX. Null for anything else.
 */
export function detectCvType(
  bytes: Uint8Array,
  filename: string,
): typeof PDF_MIME | typeof DOCX_MIME | null {
  const starts = (signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  // "%PDF-"
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return PDF_MIME;
  // A ZIP archive ("PK\x03\x04") named .docx. mammoth rejects any other ZIP.
  if (starts([0x50, 0x4b, 0x03, 0x04]) && /\.docx$/i.test(filename)) {
    return DOCX_MIME;
  }
  return null;
}
