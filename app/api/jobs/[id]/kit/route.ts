import { NextResponse } from "next/server";
import { z } from "zod";

import { getApplyKit } from "@/lib/dal/apply-kit";
import { UnauthorizedError } from "@/lib/dal/session";

/** A role's apply kit, polled by `/jobs/[id]` while Claude tailors it. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/jobs/[id]/kit">,
) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid role id." }, { status: 400 });
  }

  try {
    const kit = await getApplyKit(id.data);
    if (!kit) {
      return NextResponse.json({ error: "No such role." }, { status: 404 });
    }
    return NextResponse.json(kit);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
