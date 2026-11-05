import {
  CV_TOO_LARGE,
  DOCX_MIME,
  MAX_CV_BYTES,
  PDF_MIME,
} from "@/lib/schemas/cv-upload";

const CV_NAME = /\.(?:pdf|docx)$/i;

/**
 * Uploads a CV to /api/profile/cv, which starts Claude reading it into the
 * profile. Returns the upload's id, to follow until it's read.
 */
export async function uploadCv(file: File): Promise<{ id: string }> {
  // The server checks again, from the file's first bytes. On Vercel a bigger
  // file never reaches the Route Handler, so its size is checked here too.
  const named = CV_NAME.test(file.name);
  if (!named && file.type !== PDF_MIME && file.type !== DOCX_MIME) {
    throw new Error("Upload a PDF or a Word (.docx) file.");
  }
  if (file.size === 0) throw new Error("The file is empty.");
  if (file.size > MAX_CV_BYTES) throw new Error(CV_TOO_LARGE);
  const body = new FormData();
  body.set("file", file);
  const response = await fetch("/api/profile/cv", { method: "POST", body });
  const json: { id?: string; error?: string } = await response
    .json()
    .catch(() => ({}));
  if (!response.ok || !json.id) {
    throw new Error(json.error ?? "The upload failed. Try again.");
  }
  return { id: json.id };
}
