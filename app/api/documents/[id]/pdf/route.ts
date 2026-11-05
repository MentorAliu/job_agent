import { NextResponse } from "next/server";
import { z } from "zod";

import { getDocumentPdf } from "@/lib/dal/apply-kit";
import { UnauthorizedError } from "@/lib/dal/session";
import { fileResponse } from "@/lib/documents/file-response";

/** A tailored CV or cover letter as a PDF download. The viewer reads it too. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/documents/[id]/pdf">,
) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json(
      { error: "Invalid document id." },
      { status: 400 },
    );
  }

  try {
    const pdf = await getDocumentPdf(id.data);
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
