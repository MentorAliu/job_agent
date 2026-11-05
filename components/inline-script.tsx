/**
 * A script that runs while the server's HTML is parsed, before the first
 * paint. On the client it renders as text/plain, so React neither runs it
 * again nor warns about a script tag.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
