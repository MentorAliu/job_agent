import { NextResponse } from "next/server";

import { cvUploaded } from "@/inngest/events";
import { inngest } from "@/inngest/client";
import { createCvUpload, markCvUploadFailed } from "@/lib/dal/profile";
import { getCurrentUser, UnauthorizedError } from "@/lib/dal/session";
import { fromOwnPages } from "@/lib/request-site";
import { cvUploadSchema, detectCvType } from "@/lib/schemas/cv-upload";

/**
 * Uploads a CV (PDF or DOCX) and starts reading it in the background. A Route
 * Handler rather than a Server Action, which would cap the body at 1 MB.
 * Responds 202 with the upload's id; poll GET /api/profile/cv/[id] for the result.
 */
export async function POST(request: Request) {
  if (!fromOwnPages(request)) {
    return NextResponse.json(
      { error: "Upload your CV from the app itself." },
      { status: 403 },
    );
  }
  try {
    await getCurrentUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }

  const form = await request.formData().catch(() => null);
  const parsed = cvUploadSchema.safeParse({ file: form?.get("file") });
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid upload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { file } = parsed.data;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectCvType(bytes, file.name);
  if (!mime) {
    return NextResponse.json(
      { error: "Upload a PDF or a Word (.docx) file." },
      { status: 415 },
    );
  }

  const { id } = await createCvUpload({
    bytes,
    mime,
    originalName: file.name,
  });
  try {
    await inngest.send(cvUploaded.create({ fileId: id }));
  } catch (error) {
    // Without the event nothing would ever read the CV, so don't leave it pending.
    console.error("Couldn't send the CV upload event", error);
    const message =
      "Couldn't start reading the CV. Check that the Inngest server is running, then upload it again.";
    await markCvUploadFailed(id, message);
    return NextResponse.json({ error: message }, { status: 503 });
  }
  return NextResponse.json({ id }, { status: 202 });
}
