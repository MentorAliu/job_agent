import { NextResponse } from "next/server";
import { z } from "zod";

import { getBuiltCv } from "@/lib/dal/cvs";
import { UnauthorizedError } from "@/lib/dal/session";

/** One built CV, polled by its page while Claude writes it. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/cvs/[id]">,
) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid CV id." }, { status: 400 });
  }

  try {
    const cv = await getBuiltCv(id.data);
    if (!cv) {
      return NextResponse.json({ error: "No such CV." }, { status: 404 });
    }
    return NextResponse.json(cv);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
