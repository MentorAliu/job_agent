// Where a request comes from, as the browser says in Sec-Fetch-Site.

/**
 * Whether a request that changes something came from the app's own pages.
 * The session cookie also rides along on a plain form that another site, or
 * another app on this computer (another port of localhost is the "same
 * site"), posts here, so such a request is refused. One without the header,
 * from an older browser or a script, still needs a valid session.
 */
export function fromOwnPages(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}
