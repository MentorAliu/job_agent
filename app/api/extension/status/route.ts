import type { NextRequest } from "next/server";

import { getTailoringStatus } from "@/lib/dal/extension";
import { badRequest, extensionResponse } from "@/lib/extension/respond";
import { jobIdSchema } from "@/lib/schemas/extension";

/** Whether Claude has finished the form's answers, while the extension waits. */
export async function GET(request: NextRequest) {
  const parsed = jobIdSchema.safeParse({
    jobId: request.nextUrl.searchParams.get("jobId"),
  });
  if (!parsed.success) return badRequest();
  return extensionResponse(() => getTailoringStatus(parsed.data.jobId));
}
