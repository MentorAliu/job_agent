import { NextResponse } from "next/server";

import { listCvs } from "@/lib/dal/cvs";
import { UnauthorizedError } from "@/lib/dal/session";

/** The CVs page's cards, polled while a CV on it is being made. */
export async function GET() {
  try {
    return NextResponse.json(await listCvs());
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
