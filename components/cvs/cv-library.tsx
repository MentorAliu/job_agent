"use client";

import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileTextIcon,
  PencilIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useState } from "react";

import { deleteCvAction } from "@/app/(app)/cvs/actions";
import { PdfViewerDialog } from "@/components/documents/pdf-dialog";
import { CompanyTile } from "@/components/jobs/company-tile";
import { RelativeDate } from "@/components/jobs/relative-date";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { roleHref } from "@/lib/applications/progress";
import { callAction } from "@/lib/call-action";
import { cvListQuery } from "@/lib/cvs/queries";
import type {
  BuiltCvRow,
  CvList,
  TailoredCvRow,
  UploadedCv,
} from "@/lib/dal/cvs";
import type { BuiltCvStatus } from "@/lib/schemas/cv-builder";
import { cn } from "@/lib/utils";

import { CvCard, type CardPreview } from "./cv-card";

// The CVs page: two tabs of cards, as a file browser shows documents. The
// General tab has the uploaded CV and every CV built or edited from the
// profile; the Tailored tab, the CV in each role's apply kit. The page
// prefetches the list; this follows it while a CV on it is being made.

export const CV_TABS = ["general", "tailored"] as const;
export type CvTab = (typeof CV_TABS)[number];

const tabParser = parseAsStringLiteral(CV_TABS).withDefault("general");

const BUSY_LABELS: Record<BuiltCvStatus, string> = {
  writing: "Claude is writing it",
  checking: "Checking every claim",
  rendering: "Drawing the PDF",
  ready: "",
  failed: "",
};

/** Where Edit opens the editor for each kind of CV. */
export const editHref = {
  profile: () => "/cvs/edit",
  built: (id: string) => `/cvs/edit?cv=${id}`,
  kit: (documentId: string) => `/cvs/edit?kit=${documentId}`,
};

const GRID =
  "grid grid-cols-1 gap-3 min-[26rem]:grid-cols-2 sm:gap-4 md:grid-cols-3 2xl:grid-cols-4";

/**
 * A panel being closed stays in the page until its exit ends; hiding it at
 * once keeps the page from jumping.
 */
const PANEL = "data-ending-style:hidden";

function FileTile({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary",
        className,
      )}
    >
      <FileTextIcon className="size-4" />
    </span>
  );
}

export function CvLibrary() {
  const { data } = useSuspenseQuery(cvListQuery());
  const [tab, setTab] = useQueryState("tab", tabParser);
  const general = (data.uploaded ? 1 : 0) + data.built.length;

  return (
    <Tabs
      value={tab}
      onValueChange={(value: CvTab) => void setTab(value)}
      className="gap-5"
    >
      <div className="border-b">
        <TabsList variant="line" className="h-11 gap-5 p-0">
          <TabsTrigger
            value="general"
            className="flex-none px-0.5 group-data-horizontal/tabs:after:-bottom-px"
          >
            General
            <Count value={general} />
          </TabsTrigger>
          <TabsTrigger
            value="tailored"
            className="flex-none px-0.5 group-data-horizontal/tabs:after:-bottom-px"
          >
            Tailored for a job
            <Count value={data.tailored.length} />
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="general" className={PANEL}>
        <GeneralTab data={data} />
      </TabsContent>
      <TabsContent value="tailored" className={PANEL}>
        <TailoredTab rows={data.tailored} />
      </TabsContent>
    </Tabs>
  );
}

function Count({ value }: { value: number }) {
  return (
    <span className="rounded-full bg-muted px-1.5 text-xs leading-5 font-medium text-muted-foreground tabular-nums">
      {value}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

function GeneralTab({ data }: { data: CvList }) {
  if (!data.uploaded && data.built.length === 0) {
    return (
      <Empty>
        <p>
          No CVs yet. Upload your CV on the Profile page, then edit it into new
          ones here, or have Claude build one for a job title.
        </p>
        <Link href="/profile" className={cn(buttonVariants({ size: "sm" }))}>
          Go to Profile
        </Link>
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Your uploaded CV and the CVs made from your profile. Edit any of them to
        make a new one: keep, remove and add lines from your profile.
      </p>
      <ul aria-label="General CVs" className={GRID}>
        {data.uploaded ? (
          <UploadedCard cv={data.uploaded} canEdit={data.hasProfile} />
        ) : null}
        {data.built.map((row) => (
          <BuiltCard key={row.id} row={row} />
        ))}
      </ul>
    </div>
  );
}

function UploadedCard({ cv, canEdit }: { cv: UploadedCv; canEdit: boolean }) {
  const [viewing, setViewing] = useState(false);
  return (
    <>
      <CvCard
        title={cv.name}
        subtitle="Uploaded by you"
        date={<RelativeDate iso={cv.uploadedAt} kind="day" />}
        icon={<FileTile className="bg-muted text-muted-foreground" />}
        preview={
          cv.isPdf
            ? { kind: "pdf", url: cv.url }
            : { kind: "file", label: "Word document. Download it to read." }
        }
        open={
          cv.isPdf
            ? { kind: "button", onOpen: () => setViewing(true) }
            : { kind: "download", href: cv.url }
        }
        editHref={canEdit ? editHref.profile() : undefined}
        menuLabel={`More for ${cv.name}`}
        menu={
          <>
            {cv.isPdf ? (
              <DropdownMenuItem onClick={() => setViewing(true)}>
                <EyeIcon aria-hidden />
                View
              </DropdownMenuItem>
            ) : null}
            {canEdit ? (
              <DropdownMenuItem render={<Link href={editHref.profile()} />}>
                <PencilIcon aria-hidden />
                Edit into a new CV
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem render={<a href={cv.url} download />}>
              <DownloadIcon aria-hidden />
              Download
            </DropdownMenuItem>
          </>
        }
      />
      {cv.isPdf ? (
        <PdfViewerDialog
          open={viewing}
          onOpenChange={setViewing}
          url={cv.url}
          title={cv.name}
          description="The CV you uploaded"
        />
      ) : null}
    </>
  );
}

function builtPreview(row: BuiltCvRow): CardPreview {
  if (row.status === "failed") return { kind: "failed" };
  if (row.status !== "ready") {
    return { kind: "busy", label: BUSY_LABELS[row.status] };
  }
  return row.pdfUrl
    ? { kind: "pdf", url: row.pdfUrl }
    : { kind: "file", label: "No PDF" };
}

function BuiltCard({ row }: { row: BuiltCvRow }) {
  const [deleting, setDeleting] = useState(false);
  const ready = row.status === "ready";
  const done = ready || row.status === "failed";
  const pages = row.pageCount
    ? ` · ${row.pageCount === 1 ? "1 page" : `${row.pageCount} pages`}`
    : "";
  return (
    <>
      <CvCard
        title={row.targetTitle}
        subtitle={`${
          row.edited
            ? "Edited by you"
            : row.matched
              ? "Matched to a posting"
              : "Built by Claude"
        }${ready ? pages : ""}`}
        date={<RelativeDate iso={row.createdAt} kind="day" />}
        icon={<FileTile />}
        preview={builtPreview(row)}
        open={{ kind: "link", href: `/cvs/${row.id}` }}
        editHref={ready ? editHref.built(row.id) : undefined}
        menuLabel={`More for ${row.targetTitle}`}
        menu={
          <>
            <DropdownMenuItem render={<Link href={`/cvs/${row.id}`} />}>
              <EyeIcon aria-hidden />
              Open
            </DropdownMenuItem>
            {ready ? (
              <DropdownMenuItem render={<Link href={editHref.built(row.id)} />}>
                <PencilIcon aria-hidden />
                Edit into a new CV
              </DropdownMenuItem>
            ) : null}
            {row.pdfUrl ? (
              <DropdownMenuItem render={<a href={row.pdfUrl} download />}>
                <DownloadIcon aria-hidden />
                Download PDF
              </DropdownMenuItem>
            ) : null}
            {done ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleting(true)}
                >
                  <Trash2Icon aria-hidden />
                  Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </>
        }
      />
      <DeleteDialog row={row} open={deleting} onOpenChange={setDeleting} />
    </>
  );
}

function DeleteDialog({
  row,
  open,
  onOpenChange,
}: {
  row: BuiltCvRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const remove = async () => {
    if (pending) return;
    setPending(true);
    const result = await callAction(() => deleteCvAction(row.id));
    setPending(false);
    if (!result.ok) {
      toast.add({
        title: "Couldn't delete the CV",
        description: result.errors.formErrors.join(" "),
        type: "error",
      });
      return;
    }
    onOpenChange(false);
    toast.add({ title: "CV deleted", type: "success" });
    await queryClient.invalidateQueries({
      queryKey: cvListQuery().queryKey,
      exact: true,
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this CV?</DialogTitle>
          <DialogDescription>
            “{row.targetTitle}” and its PDF are deleted for good. Your profile
            and the other CVs stay as they are.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Keep it
          </DialogClose>
          <Button
            variant="destructive"
            aria-disabled={pending || undefined}
            onClick={remove}
          >
            {pending ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : (
              <Trash2Icon aria-hidden data-icon="inline-start" />
            )}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tailored for a job
// ---------------------------------------------------------------------------

function TailoredTab({ rows }: { rows: TailoredCvRow[] }) {
  if (rows.length === 0) {
    return (
      <Empty>
        <p>
          No tailored CVs yet. The app writes one for each role it picks, and
          they show up here.
        </p>
        <Link
          href="/cvs/new"
          className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
        >
          <SparklesIcon aria-hidden data-icon="inline-start" />
          Build one for a posting yourself
        </Link>
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        The CV in each role&apos;s apply kit. Edit one before you apply, and the
        kit sends your version.
      </p>
      <ul aria-label="Tailored CVs" className={GRID}>
        {rows.map((row) => (
          <TailoredCard key={row.id} row={row} />
        ))}
      </ul>
    </div>
  );
}

function TailoredCard({ row }: { row: TailoredCvRow }) {
  const [viewing, setViewing] = useState(false);
  const role = roleHref({ id: row.jobId, status: row.status });
  const applied = role.startsWith("/applications/");
  const title = `CV for ${row.title} at ${row.company}`;
  return (
    <>
      <CvCard
        title={row.title}
        subtitle={row.company}
        date={
          <>
            Version {row.version}
            {row.edited ? ", edited by you" : ""} ·{" "}
            <RelativeDate iso={row.readyAt} kind="day" />
          </>
        }
        icon={
          <CompanyTile
            company={row.company}
            className="mt-0.5 size-7 rounded-md text-xs"
          />
        }
        preview={
          row.pdfUrl
            ? { kind: "pdf", url: row.pdfUrl }
            : { kind: "file", label: "No PDF" }
        }
        open={
          row.pdfUrl
            ? { kind: "button", onOpen: () => setViewing(true) }
            : { kind: "link", href: role }
        }
        editHref={editHref.kit(row.id)}
        menuLabel={`More for ${title}`}
        menu={
          <>
            {row.pdfUrl ? (
              <DropdownMenuItem onClick={() => setViewing(true)}>
                <EyeIcon aria-hidden />
                View
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem render={<Link href={editHref.kit(row.id)} />}>
              <PencilIcon aria-hidden />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href={role} />}>
              <ExternalLinkIcon aria-hidden />
              {applied ? "Open the application" : "Open the apply kit"}
            </DropdownMenuItem>
            {row.pdfUrl ? (
              <DropdownMenuItem render={<a href={row.pdfUrl} download />}>
                <DownloadIcon aria-hidden />
                Download PDF
              </DropdownMenuItem>
            ) : null}
          </>
        }
      />
      {row.pdfUrl ? (
        <PdfViewerDialog
          open={viewing}
          onOpenChange={setViewing}
          url={row.pdfUrl}
          title={title}
          description={`Version ${row.version}`}
        />
      ) : null}
    </>
  );
}
