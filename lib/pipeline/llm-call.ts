import "server-only";

import { llmCall } from "@/db/schema";
import { db } from "@/lib/dal/db";

// Database access for logging Claude calls. The calls run inside Inngest steps
// with no signed-in user, so this lives here rather than in lib/dal.

export async function insertLlmCall(
  values: typeof llmCall.$inferInsert,
): Promise<void> {
  await db.insert(llmCall).values(values);
}
