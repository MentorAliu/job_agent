import { NextResponse } from "next/server";

import { UnauthorizedError } from "@/lib/dal/session";
import { getSetupState } from "@/lib/dal/setup";

/** First-run setup's progress, polled while a check, a CV read or a CV build runs. */
export async function GET() {
  try {
    return NextResponse.json(await getSetupState());
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
