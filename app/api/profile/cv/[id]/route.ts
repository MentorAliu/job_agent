import { NextResponse } from "next/server";
import { z } from "zod";

import { getCvUpload } from "@/lib/dal/profile";
import { UnauthorizedError } from "@/lib/dal/session";

/** The state of one CV upload, polled by the profile page while Claude reads it. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/profile/cv/[id]">,
) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid upload id." }, { status: 400 });
  }

  try {
    const upload = await getCvUpload(id.data);
    if (!upload) {
      return NextResponse.json({ error: "No such upload." }, { status: 404 });
    }
    return NextResponse.json(upload);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
