"use client";

import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  DownloadIcon,
  FileTextIcon,
  UploadIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { PdfDialog } from "@/components/documents/pdf-dialog";
import { LocalDate } from "@/components/jobs/local-date";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { CvUploadView } from "@/lib/dal/profile";
import { CV_ACCEPT, MAX_CV_BYTES, PDF_MIME } from "@/lib/schemas/cv-upload";
import type { MasterProfile } from "@/lib/schemas/profile";

import { count } from "./format";
import { uploadCv } from "./upload-cv";

/** A CV upload as the status Route Handler returns it (dates as strings). */
type CvUploadStatus = Omit<CvUploadView, "createdAt"> & {
  createdAt: string | Date;
};

const POLL_MS = 2000;

const SHORT_DAY: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
};

/** A CV upload, polled until Claude has read it. */
function cvUploadQuery(id: string) {
  return queryOptions({
    queryKey: ["cv-upload", id] as const,
    queryFn: async (): Promise<CvUploadStatus> => {
      const response = await fetch(`/api/profile/cv/${id}`);
      if (!response.ok) throw new Error("Couldn't check on the CV.");
      return response.json();
    },
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data && query.state.data.status !== "pending"
        ? false
        : POLL_MS,
  });
}

/**
 * The CV as uploaded: a PDF opens in the app's viewer, and a Word file, which
 * the viewer can't show, downloads.
 */
function CvFile({ cv }: { cv: CvUploadStatus }) {
  const url = `/api/profile/cv/${cv.id}/file`;
  const name = cv.originalName ?? "Your CV";
  if (cv.mime === PDF_MIME) {
    return <PdfDialog url={url} title={name} label="View" size="default" />;
  }
  return (
    // A link, not a button: it downloads a file.
    <a href={url} download className={buttonVariants({ variant: "outline" })}>
      <DownloadIcon aria-hidden data-icon="inline-start" />
      Download<span className="sr-only"> {name}</span>
    </a>
  );
}

/** "5 roles, 21 skills and 1 school": what Claude found in a CV. */
function found(profile: MasterProfile): string {
  return `${count(profile.experience.length, "role")}, ${count(profile.skills.length, "skill")} and ${count(profile.education.length, "school")}`;
}

/**
 * The CV the profile came from, and Upload a new CV. Claude reads a new CV
 * into the profile by itself; this polls until it's done, then reloads the
 * page's summary.
 */
export function CvCard({
  savedCv,
  latestUpload,
}: {
  /** The CV upload the profile was filled from, if any. */
  savedCv: CvUploadView | null;
  latestUpload: CvUploadView | null;
}) {
  const headingId = useId();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pendingId, setPendingId] = useState<string | null>(
    latestUpload?.status === "pending" ? latestUpload.id : null,
  );

  const upload = useMutation({
    mutationFn: uploadCv,
    onSuccess: ({ id }) => setPendingId(id),
  });

  const polled = useQuery({
    ...cvUploadQuery(pendingId ?? ""),
    enabled: pendingId !== null,
  });

  // The newest upload we know of: the one just polled, else the one the page loaded with.
  const current: CvUploadStatus | null =
    pendingId && polled.data?.id === pendingId
      ? polled.data
      : pendingId
        ? null
        : latestUpload;
  const reading =
    upload.isPending ||
    (pendingId !== null && current === null) ||
    current?.status === "pending";
  const justRead =
    pendingId !== null && current?.status === "succeeded" ? current : null;

  // Once Claude has saved the new profile, the summary below is out of date.
  const readId = justRead?.id;
  useEffect(() => {
    if (readId) router.refresh();
  }, [readId, router]);

  const shown = justRead ?? savedCv;
  let notice: React.ReactNode = null;
  if (upload.isError) {
    notice = (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>The upload didn&apos;t go through</AlertTitle>
        <AlertDescription>{upload.error.message}</AlertDescription>
      </Alert>
    );
  } else if (reading) {
    notice = (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Spinner aria-hidden />
        {upload.isPending
          ? "Uploading…"
          : "Claude is reading your CV into your profile. This usually takes under a minute."}
      </p>
    );
  } else if (polled.isError) {
    notice = (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>Lost track of the upload</AlertTitle>
        <AlertDescription>
          Reload the page to see whether Claude finished reading it.
        </AlertDescription>
      </Alert>
    );
  } else if (current?.status === "failed") {
    notice = (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>
          Claude couldn&apos;t read {current.originalName ?? "the CV"}
        </AlertTitle>
        <AlertDescription>
          {current.error ??
            "Something went wrong. Try uploading it again, or as a PDF."}
          {" Your profile didn't change."}
        </AlertDescription>
      </Alert>
    );
  } else if (justRead?.parsedProfile) {
    notice = (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-success-ink"
      >
        <CircleCheckIcon aria-hidden className="size-4" />
        Your profile now comes from this CV: {found(justRead.parsedProfile)}.
      </p>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col rounded-xl border bg-card shadow-xs"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:px-5">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-ink"
        >
          <FileTextIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="truncate text-sm font-semibold">
            {shown?.originalName ?? "Your CV"}
          </h2>
          <p className="text-[0.8125rem] text-muted-foreground">
            {shown ? (
              <>
                Read on{" "}
                <LocalDate
                  iso={new Date(shown.createdAt).toISOString()}
                  format={SHORT_DAY}
                />
                {shown.parsedProfile
                  ? ` · ${found(shown.parsedProfile)}`
                  : null}
              </>
            ) : (
              "Upload a PDF or Word file. Claude reads it into your profile; nothing to fill in."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 max-sm:w-full max-sm:justify-between">
          <span className="text-xs text-muted-foreground">
            PDF or DOCX, up to {MAX_CV_BYTES / 1024 / 1024} MB
          </span>
          {shown ? <CvFile cv={shown} /> : null}
          {/* Stays enabled while Claude reads, so an upload that never finishes can be replaced. */}
          <Button
            type="button"
            variant={shown ? "outline" : "default"}
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {upload.isPending ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : (
              <UploadIcon data-icon="inline-start" />
            )}
            {shown ? "Upload a new CV" : "Upload CV"}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={CV_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label="CV file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload.mutate(file);
            }}
          />
        </div>
      </div>
      <div aria-live="polite" className="px-4 sm:px-5">
        {notice ? (
          <div className="flex flex-col gap-3 pb-4">{notice}</div>
        ) : null}
      </div>
    </section>
  );
}
