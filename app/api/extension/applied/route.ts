import { markSubmitted } from "@/lib/dal/extension";
import { badRequest, extensionResponse, isJson } from "@/lib/extension/respond";
import { jobIdSchema } from "@/lib/schemas/extension";

/** The owner submitted the form the extension filled: the role is Applied. */
export async function POST(request: Request) {
  if (!isJson(request)) return badRequest();
  const parsed = jobIdSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest();
  return extensionResponse(async () => ({
    marked: await markSubmitted(parsed.data.jobId),
  }));
}
