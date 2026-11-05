import { NextResponse, type NextRequest } from "next/server";

import { getLatestEngineCheck } from "@/lib/dal/engine-check";
import { UnauthorizedError } from "@/lib/dal/session";
import { isAgentEngine } from "@/lib/schemas/settings";

/** The latest Check it works for ?engine=, polled while it runs. */
export async function GET(request: NextRequest) {
  const engine = request.nextUrl.searchParams.get("engine") ?? "";
  if (!isAgentEngine(engine)) {
    return NextResponse.json({ error: "Unknown engine." }, { status: 400 });
  }
  try {
    return NextResponse.json({ check: await getLatestEngineCheck(engine) });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
