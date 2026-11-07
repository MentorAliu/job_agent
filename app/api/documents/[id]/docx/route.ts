import { NextResponse } from "next/server";
import { z } from "zod";

import { getDocumentDocx } from "@/lib/dal/apply-kit";
import { UnauthorizedError } from "@/lib/dal/session";
import { fileResponse } from "@/lib/documents/file-response";
import { DOCX_MIME } from "@/lib/schemas/cv-upload";

/** A tailored CV or cover letter as a Word download, matching its PDF. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/documents/[id]/docx">,
) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json(
      { error: "Invalid document id." },
      { status: 400 },
    );
  }

  try {
    const docx = await getDocumentDocx(id.data);
    if (!docx) {
      return NextResponse.json(
        { error: "No such document, or it has no Word file." },
        { status: 404 },
      );
    }
    return fileResponse({ ...docx, mime: DOCX_MIME });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
