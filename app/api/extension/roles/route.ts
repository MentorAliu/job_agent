import type { NextRequest } from "next/server";

import { getRolesForPage } from "@/lib/dal/extension";
import { badRequest, extensionResponse } from "@/lib/extension/respond";
import { pageUrlSchema } from "@/lib/schemas/extension";

/** The role for the page the form filler is on, and the others it could be. */
export async function GET(request: NextRequest) {
  const parsed = pageUrlSchema.safeParse({
    url: request.nextUrl.searchParams.get("url") ?? "",
  });
  if (!parsed.success) return badRequest();
  return extensionResponse(() => getRolesForPage(parsed.data.url));
}
