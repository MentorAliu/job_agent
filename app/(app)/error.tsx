"use client";

import { CircleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

// Shown inside the app shell when a page fails to load, such as when the
// database can't be reached. Server errors arrive without their message, so
// the digest is what matches the server log.
export default function AppError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest =
    error instanceof Error && "digest" in error
      ? String((error as Error & { digest?: string }).digest ?? "")
      : "";

  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleAlertIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>
          <h1 className="text-base">This page couldn&apos;t load</h1>
        </EmptyTitle>
        <EmptyDescription>
          Something went wrong on the server. Check that the database and the
          app are running, then try again.
          {digest ? ` Error reference: ${digest}.` : null}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex items-center gap-3">
          <Button onClick={() => retry()}>Try again</Button>
          <Link href="/" className="text-sm underline underline-offset-4">
            Go to Today
          </Link>
        </div>
      </EmptyContent>
    </Empty>
  );
}
