// Which tools in a posting's stack the owner already lists. Names are
// compared loosely, so "Next.js", "NextJS" and "next js" are one tool.

/** Other names for the same tool, by their reduced form. */
const ALIASES: Record<string, string> = {
  js: "javascript",
  ecmascript: "javascript",
  ts: "typescript",
  reactquery: "tanstackquery",
  postgresql: "postgres",
  golang: "go",
  k8s: "kubernetes",
  css3: "css",
  html5: "html",
};

/** A tool's name reduced for comparison: lowercase, no spaces or dots, no ".js". */
export function stackKey(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9+#]/g, "");
  const tool = key.length >= 4 && key.endsWith("js") ? key.slice(0, -2) : key;
  return ALIASES[tool] ?? tool;
}

/** Whether a tool is one the owner lists. */
export function stackMatcher(
  own: readonly string[],
): (tool: string) => boolean {
  const keys = new Set(own.map(stackKey));
  return (tool) => keys.has(stackKey(tool));
}
