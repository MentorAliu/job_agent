import { inngest } from "@/inngest/client";
import { tailorRequested } from "@/inngest/events";
import { markTailoringFailed } from "@/lib/dal/apply-kit";
import { planFormFill } from "@/lib/dal/extension";
import { badRequest, extensionResponse, isJson } from "@/lib/extension/respond";
import { fillRequestSchema } from "@/lib/schemas/extension";

/**
 * What goes in each field of the form the extension read. When the form
 * asks questions nothing answers yet, starts Claude on them.
 */
export async function POST(request: Request) {
  if (!isJson(request)) return badRequest();
  const parsed = fillRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return badRequest();
  return extensionResponse(async () => {
    const { requestId, ...plan } = await planFormFill(parsed.data);
    if (requestId) {
      try {
        await inngest.send(
          tailorRequested.create({ jobId: parsed.data.jobId, requestId }),
        );
      } catch (error) {
        console.error("Couldn't send the tailoring event", error);
        await markTailoringFailed(
          parsed.data.jobId,
          requestId,
          "Couldn't start writing the form's answers.",
        );
        return { ...plan, writing: null };
      }
    }
    return plan;
  });
}
