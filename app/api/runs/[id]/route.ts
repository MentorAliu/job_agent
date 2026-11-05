import { NextResponse } from "next/server";
import { z } from "zod";

import { getRun } from "@/lib/dal/runs";
import { UnauthorizedError } from "@/lib/dal/session";

/** One run and the postings it found, polled by the run page and the header. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/runs/[id]">,
) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid run id." }, { status: 400 });
  }

  try {
    const run = await getRun(id.data);
    if (!run) {
      return NextResponse.json({ error: "No such run." }, { status: 404 });
    }
    return NextResponse.json(run);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
