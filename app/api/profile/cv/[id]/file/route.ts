import { NextResponse } from "next/server";
import { z } from "zod";

import { getCvFile } from "@/lib/dal/profile";
import { UnauthorizedError } from "@/lib/dal/session";
import { fileResponse } from "@/lib/documents/file-response";

/** An uploaded CV, PDF or DOCX, as a download. The viewer reads a PDF one. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/profile/cv/[id]/file">,
) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid upload id." }, { status: 400 });
  }

  try {
    const cv = await getCvFile(id.data);
    if (!cv) {
      return NextResponse.json({ error: "No such upload." }, { status: 404 });
    }
    return fileResponse(cv);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
