import { NextResponse } from "next/server";

import { UnauthorizedError } from "@/lib/dal/session";
import { getTopBar } from "@/lib/dal/top-bar";

/** The top bar: the search, new roles and the next step. */
export async function GET() {
  try {
    return NextResponse.json(await getTopBar());
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
