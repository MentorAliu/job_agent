// Syncs the app with a self-hosted Inngest server when the app starts. The
// server only learns about functions when the app is synced, and after a
// rebuild that adds one it didn't pick the new function up on its own.

type SyncOptions = {
  attempts?: number;
  delayMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Sends the `PUT` that makes the Inngest SDK register the app's functions,
 * retrying while the app or the Inngest server is still starting. Returns
 * whether a sync went through.
 */
export async function syncInngestApp(
  endpoint: string,
  {
    attempts = 60,
    delayMs = 2000,
    fetch: send = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }: SyncOptions = {},
): Promise<boolean> {
  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await send(endpoint, { method: "PUT" });
      if (response.ok) return true;
      lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  console.warn(
    `Couldn't sync the app with Inngest after ${attempts} tries (${lastError}). Open the Inngest dashboard and resync the app.`,
  );
  return false;
}
