// Where sign-in goes back to: the page a signed-out visitor asked for. The
// proxy puts it in /sign-in?next=..., and the sign-in page reads it back.
// Shared by the proxy, the sign-in page and its form, so it has no imports.

/** The query parameter that carries the page. */
export const RETURN_TO_PARAM = "next";

/** Longer addresses aren't kept; sign-in then opens the app's start page. */
const MAX_LENGTH = 2000;

/**
 * `value` as a path on this app ("/jobs/1?tab=kit"), or null when it isn't
 * one: another site ("//evil.example", "https://..."), the sign-in page
 * itself, or nothing at all. Never a way to send the owner elsewhere.
 */
export function returnPath(value: string | null | undefined): string | null {
  if (!value || value.length > MAX_LENGTH || !value.startsWith("/")) {
    return null;
  }
  // "/\evil.example" reads as "//evil.example" in a browser.
  if (/^\/[/\\]/.test(value) || /[\u0000-\u001f\\]/.test(value)) return null;
  const base = "http://app.invalid";
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (url.origin !== base) return null;
  if (url.pathname === "/" && !url.search) return null;
  if (url.pathname === "/sign-in" || url.pathname.startsWith("/api/")) {
    return null;
  }
  return `${url.pathname}${url.search}`;
}
