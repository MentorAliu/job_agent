"use client";

// Replaces the root layout when it fails, so it brings its own <html> and
// <body> and can't rely on the app's styles.
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          maxWidth: "28rem",
          margin: "4rem auto",
          padding: "0 1rem",
          lineHeight: 1.5,
        }}
      >
        <title>Error · Job Agent</title>
        <h1 style={{ fontSize: "1.5rem" }}>Job Agent couldn&apos;t load</h1>
        <p>
          Something went wrong on the server. Check that the database and the
          app are running, then try again.
        </p>
        <button type="button" onClick={() => retry()}>
          Try again
        </button>
      </body>
    </html>
  );
}
