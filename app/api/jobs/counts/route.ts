import { NextResponse } from "next/server";

import { getJobCounts } from "@/lib/dal/jobs";
import { UnauthorizedError } from "@/lib/dal/session";

/** The numbers next to Inbox and Tracker in the header. */
export async function GET() {
  try {
    return NextResponse.json(await getJobCounts());
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
