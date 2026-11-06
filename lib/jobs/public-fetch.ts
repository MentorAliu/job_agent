import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

// Plain GET requests to public websites, for the daily listing check and the
// job boards each search checks. No Claude call, so they cost nothing. A
// link that isn't a public website, or a redirect to one that isn't, is
// never fetched: not by its name, and not by the address the name points
// to, so a posting can't point the app at the computer or network it runs on.

/** A response, after redirects, or why there was none. */
export type Fetched =
  | { ok: true; status: number; url: string; redirected: boolean; text: string }
  | { ok: false };

export type FetchOptions = {
  /** For tests. The default checks where each host name points first. */
  fetch?: typeof fetch;
  /** Shared by the requests of one step, so a job board is fetched once. */
  cache?: Map<string, Promise<Fetched>>;
};

/** One request, with its redirects followed, cut off after this long. */
export const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
/** Enough for a big company's whole job board; anything longer is cut. */
const MAX_BODY_CHARS = 10_000_000;
/** Says what the request is; a site that blocks it is left alone. */
const USER_AGENT =
  "JobAgent/1.0 (reads public job postings for one person's job search)";

/** No IP addresses, local names or unusual ports: only public websites. */
export function isPublicUrl(url: URL): boolean {
  // "localhost." is "localhost": a final dot only makes the name absolute.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    url.port === "" &&
    url.username === "" &&
    host.includes(".") &&
    !host.includes(":") &&
    !/^[\d.]+$/.test(host) &&
    !/\.(local|localhost|internal|lan|home|corp)$/.test(host)
  );
}

/**
 * Addresses no public website has: this computer, private and shared
 * networks, link-local ones (such as a cloud server's metadata service at
 * 169.254.169.254), and those reserved for documentation, tests or
 * multicast. IPv4 addresses written as IPv6 (::ffff:10.0.0.1) count as IPv4.
 */
const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 127],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, "ipv6");
}

/** Whether an IP address can belong to a public website. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) return false;
  return !NOT_PUBLIC.check(address, version === 6 ? "ipv6" : "ipv4");
}

/** Every address a host name points to. */
export type ResolveHost = (host: string) => Promise<string[]>;

const resolveHost: ResolveHost = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map(
    ({ address }) => address,
  );

/**
 * `fetch`, but only to a host whose every address is public, checked just
 * before each request (redirects included, since `get` makes one request
 * per hop). A name that doesn't resolve isn't fetched either.
 */
export function publicOnlyFetch(
  resolve: ResolveHost = resolveHost,
  fetchFn: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = await resolve(host);
    if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
      throw new Error(`${host} doesn't point to a public website.`);
    }
    return fetchFn(input, init);
  };
}

const defaultFetch = publicOnlyFetch();

/**
 * GETs a URL, following up to five redirects by hand so that each hop is
 * checked to be a public website too.
 */
async function get(
  url: string,
  accept: string,
  fetchFn: typeof fetch,
): Promise<Fetched> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return { ok: false };
  }
  if (!isPublicUrl(current)) return { ok: false };
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await fetchFn(current, {
        redirect: "manual",
        signal,
        headers: { accept, "user-agent": USER_AGENT },
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        const next = new URL(location, current);
        if (!isPublicUrl(next)) return { ok: false };
        current = next;
        continue;
      }
      const type = response.headers.get("content-type") ?? "";
      // RSS feeds come as application/rss+xml.
      const readable = /json|html|text|xml/i.test(type) || type === "";
      const text = readable ? await readText(response) : "";
      if (!readable) await response.body?.cancel();
      return {
        ok: true,
        status: response.status,
        url: current.toString(),
        redirected: hop > 0,
        text,
      };
    }
  } catch {
    // A timeout, a refused connection or a bad redirect.
  }
  return { ok: false };
}

/** The body as text, up to MAX_BODY_CHARS. */
async function readText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  while (text.length < MAX_BODY_CHARS) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return text;
}

/** GETs a public URL once per cache, however many checks ask for it. */
export function fetchPublic(
  url: string,
  accept: string,
  { fetch: fetchFn = defaultFetch, cache }: FetchOptions = {},
): Promise<Fetched> {
  if (!cache) return get(url, accept, fetchFn);
  const key = `${accept} ${url}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = get(url, accept, fetchFn);
    cache.set(key, pending);
  }
  return pending;
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
