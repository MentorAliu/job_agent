// Runs once when the Next.js server starts.
export async function register() {
  // In Docker (compose.yml sets INNGEST_SERVE_ORIGIN), sync the app with the
  // self-hosted Inngest server, so functions added by a rebuild work at once.
  // Not awaited: the server must start before it can answer the sync.
  // On Vercel, Inngest's integration syncs each deploy instead.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.INNGEST_SERVE_ORIGIN || process.env.VERCEL) return;
  const { syncInngestApp } = await import("./inngest/sync");
  const port = process.env.PORT ?? "3000";
  void syncInngestApp(`http://127.0.0.1:${port}/api/inngest`);
}
