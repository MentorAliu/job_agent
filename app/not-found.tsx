import Link from "next/link";

// For addresses that match no page at all.
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-3 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        There&apos;s no page at this address.
      </p>
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-4">
          Go to Today
        </Link>
      </p>
    </main>
  );
}
