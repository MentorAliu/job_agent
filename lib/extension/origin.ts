/**
 * The address the owner's browser reached the app at. Behind a proxy, or
 * self-hosted in Docker, `request.url` holds the server's own address
 * (http://0.0.0.0:3000), which the browser can't sign in at, so the Host
 * headers win.
 */
export function appOrigin(request: Request): string {
  const url = new URL(request.url);
  const first = (name: string) =>
    request.headers.get(name)?.split(",")[0]?.trim() || null;
  const host = first("x-forwarded-host") ?? first("host");
  if (!host) return url.origin;
  const protocol = first("x-forwarded-proto") ?? url.protocol.slice(0, -1);
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return url.origin;
  }
}
