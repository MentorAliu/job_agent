import { NextResponse } from "next/server";
import { z } from "zod";

import { getBuiltCvDocx } from "@/lib/dal/cvs";
import { UnauthorizedError } from "@/lib/dal/session";
import { fileResponse } from "@/lib/documents/file-response";
import { DOCX_MIME } from "@/lib/schemas/cv-upload";

/** A built CV as a Word download, made from the same content as its PDF. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/cvs/[id]/docx">,
) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid CV id." }, { status: 400 });
  }

  try {
    const docx = await getBuiltCvDocx(id.data);
    if (!docx) {
      return NextResponse.json(
        { error: "No such CV, or it isn't ready yet." },
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
