import { NextResponse } from "next/server";

import { getPastedEmails } from "@/lib/dal/emails";
import { UnauthorizedError } from "@/lib/dal/session";

/**
 * The emails pasted on the Applications page that are being read, couldn't
 * be placed, or were just filed. Polled while Claude reads one.
 */
export async function GET() {
  try {
    return NextResponse.json(await getPastedEmails());
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
