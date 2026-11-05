import { syncInngestApp } from "../inngest/sync";

import { compose, smokeEnv } from "./stack";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `url` until it answers with a success, or gives up. */
async function waitForPage(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(2000);
  }
  throw new Error(`${url} didn't come up (${last}).`);
}

/**
 * Starts the smoke stack from scratch: the app as `--profile app` builds
 * it, with a fake Claude API and fresh volumes. Then waits for the app and
 * syncs it with Inngest, so the first event finds its functions.
 */
export default async function globalSetup(): Promise<void> {
  const env = smokeEnv();
  compose("down", "--volumes", "--remove-orphans");
  compose("up", "--build", "--detach");
  const base = `http://localhost:${env.APP_PORT}`;
  await waitForPage(`${base}/sign-in`, 5 * 60_000);
  const synced = await syncInngestApp(`${base}/api/inngest`, {
    attempts: 60,
    delayMs: 2000,
  });
  if (!synced) throw new Error("The app couldn't sync with Inngest.");
}
