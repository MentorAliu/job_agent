import { NextResponse } from "next/server";
import { z } from "zod";

import { getJobDetail } from "@/lib/dal/jobs";
import { UnauthorizedError } from "@/lib/dal/session";

/** One role with its facts, notes and timeline, for the detail drawer. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/jobs/[id]">,
) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid role id." }, { status: 400 });
  }

  try {
    const detail = await getJobDetail(id.data);
    if (!detail) {
      return NextResponse.json({ error: "No such role." }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
