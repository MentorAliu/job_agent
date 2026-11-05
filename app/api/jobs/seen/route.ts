import { NextResponse } from "next/server";

import { markRolesSeen } from "@/lib/dal/roles-seen";
import { UnauthorizedError } from "@/lib/dal/session";

/**
 * The Roles page calls this once it's open, to move the owner's last visit
 * on. It's a Route Handler, not a Server Action, because a Server Action
 * that sets a cookie renders the whole page again, and nothing on it changes.
 */
export async function POST() {
  try {
    await markRolesSeen();
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
