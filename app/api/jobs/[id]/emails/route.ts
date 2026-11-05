import { NextResponse } from "next/server";
import { z } from "zod";

import { getRoleEmails } from "@/lib/dal/emails";
import { UnauthorizedError } from "@/lib/dal/session";

/** The emails pasted into a role, polled by `/jobs/[id]` while Claude reads one. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/jobs/[id]/emails">,
) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid role id." }, { status: 400 });
  }

  try {
    return NextResponse.json(await getRoleEmails(id.data));
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
