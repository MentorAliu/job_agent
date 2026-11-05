import { NextResponse } from "next/server";
import { z } from "zod";

import { getBuiltCvPdf } from "@/lib/dal/cvs";
import { UnauthorizedError } from "@/lib/dal/session";
import { fileResponse } from "@/lib/documents/file-response";

/** A built CV as a PDF download. The viewer reads it too. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/cvs/[id]/pdf">,
) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid CV id." }, { status: 400 });
  }

  try {
    const pdf = await getBuiltCvPdf(id.data);
    if (!pdf) {
      return NextResponse.json({ error: "No such PDF." }, { status: 404 });
    }
    return fileResponse({ ...pdf, mime: "application/pdf" });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
