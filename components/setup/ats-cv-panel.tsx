"use client";

import {
  CircleAlertIcon,
  DownloadIcon,
  FileTextIcon,
  RefreshCwIcon,
} from "lucide-react";

import { PdfDialog } from "@/components/documents/pdf-dialog";
import { PdfThumbnail } from "@/components/documents/pdf-thumbnail";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { SetupAtsCv } from "@/lib/dal/setup";
import { isBuildActive, type BuiltCvStatus } from "@/lib/schemas/cv-builder";

const BUSY_LABELS: Partial<Record<BuiltCvStatus, string>> = {
  writing: "Writing it from your profile",
  checking: "Checking every line against your profile",
  rendering: "Fitting it to the page",
};

/**
 * The ATS-friendly CV the agent writes from the profile: an offer to write
 * one, its progress, the first page once it's ready, or what went wrong.
 */
export function AtsCvPanel({
  atsCv,
  optional,
  pending,
  error,
  onBuild,
}: {
  atsCv: SetupAtsCv | null;
  /** After an upload it's an extra; on the form path it's the point. */
  optional: boolean;
  /** A build is being started. */
  pending: boolean;
  error: string | null;
  onBuild: () => void;
}) {
  const startError = error ? (
    <p role="alert" className="text-[0.8125rem] text-destructive">
      {error}
    </p>
  ) : null;

  if (!atsCv) {
    if (!optional) return startError;
    return (
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-sm font-medium">
              Want an ATS-friendly CV too? (optional)
            </p>
            <p className="text-[0.8125rem] text-muted-foreground">
              The agent writes a clean one- or two-page CV from your profile,
              every line traced to it, that hiring systems read well. The kits
              write a CV for each role anyway, so you can skip this.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={onBuild}
          >
            {pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
            Write one
          </Button>
        </div>
        {startError}
      </div>
    );
  }

  if (isBuildActive(atsCv) || pending) {
    return (
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-lg border bg-muted/40 p-3.5 text-[0.8125rem]"
      >
        <Spinner aria-hidden className="mt-0.5 shrink-0" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-medium">
            Writing your ATS-friendly CV:{" "}
            {BUSY_LABELS[atsCv.status] ?? "starting"}…
          </p>
          <p className="text-muted-foreground">
            This takes a minute or two. You can leave this page; it carries on.
          </p>
        </div>
      </div>
    );
  }

  if (atsCv.status === "failed") {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>The agent couldn&apos;t write your CV</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <p>{atsCv.error ?? "Something went wrong. Try again."}</p>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={onBuild}
            >
              <RefreshCwIcon aria-hidden data-icon="inline-start" />
              Try again
            </Button>
          </div>
          {startError}
        </AlertDescription>
      </Alert>
    );
  }

  // Ready: the first page, with the viewer and a download.
  const pages =
    atsCv.pageCount === null
      ? null
      : atsCv.pageCount === 1
        ? "One page"
        : `${atsCv.pageCount} pages`;
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3.5 sm:flex-row sm:items-start">
      <div className="h-44 w-32 shrink-0 overflow-hidden rounded-sm border bg-card px-2 pt-2 max-sm:self-center">
        {atsCv.pdfUrl ? (
          <PdfThumbnail url={atsCv.pdfUrl} className="shadow-sm" />
        ) : (
          <FileTextIcon
            aria-hidden
            className="m-auto mt-12 size-8 text-muted-foreground"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm font-medium">Your ATS-friendly CV is ready</p>
        <p className="text-[0.8125rem] text-muted-foreground">
          {pages ? `${pages}. ` : null}
          Every line comes from your profile. It&apos;s also on the CVs page.
        </p>
        {atsCv.outdated ? (
          <p className="text-[0.8125rem] text-warning-ink">
            Your profile changed after it was written, so it&apos;s out of date.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {atsCv.pdfUrl ? (
            <>
              <PdfDialog
                url={atsCv.pdfUrl}
                title="Your ATS-friendly CV"
                label="View"
              />
              {/* A link, not a button: it downloads a file. */}
              <a
                href={atsCv.pdfUrl}
                download
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <DownloadIcon aria-hidden data-icon="inline-start" />
                Download
              </a>
            </>
          ) : null}
          {atsCv.outdated ? (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={onBuild}
            >
              {pending ? (
                <Spinner aria-hidden data-icon="inline-start" />
              ) : (
                <RefreshCwIcon aria-hidden data-icon="inline-start" />
              )}
              Write it again
            </Button>
          ) : null}
        </div>
        {startError}
      </div>
    </div>
  );
}
