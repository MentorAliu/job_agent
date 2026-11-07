"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CircleAlertIcon,
  DownloadIcon,
  ExternalLinkIcon,
  PencilIcon,
  PlusIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { CopyButton } from "@/components/copy-button";
import { KeywordCoverage } from "@/components/cvs/keyword-coverage";
import { PdfDialog } from "@/components/documents/pdf-dialog";
import { applyServerErrors } from "@/components/form-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import type { ApplyKit, KitDocument } from "@/lib/dal/apply-kit";
import type { AnswerView, CvDiff, CvView } from "@/lib/documents/view";
import type { DiffPart } from "@/lib/documents/word-diff";
import { answerProgress, answersText } from "@/lib/jobs/kit-steps";
import { savedAnswerSchema, type SavedAnswer } from "@/lib/schemas/profile";
import { isTailoringActive, type ClaimFlag } from "@/lib/schemas/tailor";
import { cn } from "@/lib/utils";

import { formatSalary } from "./labels";
import { LocalDate } from "./local-date";
import { RelativeDate } from "./relative-date";
import {
  ActionError,
  useAddCvSkills,
  useSaveKitAnswer,
} from "./use-job-actions";

// The documents in the apply kit, one tab each: what Claude wrote, what it
// left out and why, and the buttons that take each part to the form.

export const KIT_TABS = [
  "cv",
  "letter",
  "answers",
  "details",
  "company",
] as const;
export type KitTab = (typeof KIT_TABS)[number];

/** The tabs this kit has, in order. Your details is always there. */
export function kitTabs(kit: ApplyKit): KitTab[] {
  return KIT_TABS.filter(
    (tab) =>
      (tab === "cv" && kit.cv) ||
      (tab === "letter" && kit.letter) ||
      (tab === "answers" && kit.answers) ||
      tab === "details" ||
      (tab === "company" && kit.brief),
  );
}

/** The tab's name, shortened on a phone. */
function TabName({ short, long }: { short: string; long: string }) {
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="max-w-48 truncate max-sm:hidden">{long}</span>
    </>
  );
}

/**
 * A panel being closed stays in the page until its exit ends; hiding it at
 * once keeps the page from jumping, and from holding two panels for a frame.
 */
const PANEL = "data-ending-style:hidden";

export function KitDocuments({
  kit,
  tab,
  onTabChange,
}: {
  kit: ApplyKit;
  tab: KitTab;
  onTabChange: (tab: KitTab) => void;
}) {
  const tabs = kitTabs(kit);
  const shown = tabs.includes(tab) ? tab : tabs[0];
  const forYou = answerProgress(kit.answers).forYou.length;

  return (
    <section
      aria-labelledby="kit-documents-heading"
      className="overflow-hidden rounded-xl border bg-card"
    >
      <h2 id="kit-documents-heading" className="sr-only">
        Documents
      </h2>
      <Tabs
        value={shown}
        onValueChange={(value: KitTab) => onTabChange(value)}
        className="gap-0"
      >
        <div className="overflow-x-auto border-b px-3 sm:px-5">
          <TabsList variant="line" className="h-12 gap-4 p-0 sm:gap-5">
            {tabs.map((value) => (
              <TabsTrigger
                key={value}
                value={value}
                className="flex-none px-0.5 group-data-horizontal/tabs:after:-bottom-px"
              >
                {value === "cv" ? (
                  "CV"
                ) : value === "letter" ? (
                  <TabName short="Letter" long="Cover letter" />
                ) : value === "answers" ? (
                  <>
                    Answers
                    {forYou > 0 ? (
                      <>
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full bg-warning"
                        />
                        <span className="sr-only">
                          {" "}
                          ({forYou} for you to answer)
                        </span>
                      </>
                    ) : null}
                  </>
                ) : value === "details" ? (
                  <TabName short="Details" long="Your details" />
                ) : (
                  <TabName short="Company" long={`About ${kit.job.company}`} />
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {kit.cv ? (
          <TabsContent value="cv" className={PANEL}>
            <CvPanel
              cv={kit.cv}
              jobId={kit.job.id}
              company={kit.job.company}
              canAddSkills={kit.canTailor && !isTailoringActive(kit.tailoring)}
            />
          </TabsContent>
        ) : null}
        {kit.letter ? (
          <TabsContent value="letter" className={PANEL}>
            <LetterPanel letter={kit.letter} company={kit.job.company} />
          </TabsContent>
        ) : null}
        {kit.answers ? (
          <TabsContent value="answers" className={PANEL}>
            <AnswersPanel kit={kit} answers={kit.answers} />
          </TabsContent>
        ) : null}
        <TabsContent value="details" className={PANEL}>
          <DetailsPanel kit={kit} />
        </TabsContent>
        {kit.brief ? (
          <TabsContent value="company" className={PANEL}>
            <CompanyPanel company={kit.job.company} brief={kit.brief} />
          </TabsContent>
        ) : null}
      </Tabs>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared parts
// ---------------------------------------------------------------------------

/** A panel's top row: what it shows on the left, its buttons on the right. */
function Toolbar({
  children,
  actions,
  meta,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  /** A line under the row, when the row's left side is taken. */
  meta?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
          {children}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {meta ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
    </div>
  );
}

/** Where a document sits on screen: a page on a grey desk. */
const DESK = "flex flex-col gap-4 bg-muted/50 p-3 sm:p-6";
const PAPER =
  "mx-auto flex w-full max-w-[46rem] flex-col gap-5 rounded-lg border bg-card px-5 py-6 text-[0.8125rem] leading-relaxed shadow-sm sm:px-10 sm:py-9";

function DocumentMeta({
  document,
  more,
}: {
  document: KitDocument;
  /** Another fact for the end of the line. */
  more?: string;
}) {
  return (
    <span>
      Version {document.version} ·{" "}
      {document.edited ? "edited by you" : "written"}{" "}
      <RelativeDate iso={document.readyAt} kind="found" />
      {document.note ? <> · your note: “{document.note}”</> : null}
      {more ? <> · {more}</> : null}
    </span>
  );
}

/** View PDF, which opens it in the app, Download PDF, and the Word file. */
function PdfLinks({
  document,
  title,
}: {
  document: KitDocument;
  /** What the PDF is, for the viewer's heading. */
  title: string;
}) {
  if (!document.pdfUrl) return null;
  return (
    <>
      <PdfDialog
        url={document.pdfUrl}
        title={title}
        description={`Version ${document.version}`}
      />
      {/* A link, not a button: it downloads a file. */}
      <a
        href={document.pdfUrl}
        download
        className={cn(
          buttonVariants({ size: "sm" }),
          "bg-foreground text-background hover:bg-foreground/85",
        )}
      >
        <DownloadIcon aria-hidden data-icon="inline-start" />
        Download PDF
      </a>
      <a
        href={`/api/documents/${document.id}/docx`}
        download
        aria-label="Download as a Word file"
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        <DownloadIcon aria-hidden data-icon="inline-start" />
        Word
      </a>
    </>
  );
}

const FLAG_LABELS: Record<ClaimFlag["kind"], string> = {
  no_source: "No source",
  unknown_source: "Unknown source",
  wrong_entry: "Wrong role",
  unsupported: "Not supported",
};

/** Whether Claude checked the claims, and what was left out. */
function CheckSummary({
  document,
  listFlags = true,
}: {
  document: KitDocument;
  /** False where the flagged items are shown in place instead. */
  listFlags?: boolean;
}) {
  if (document.checkError) {
    return (
      <>
        <Alert className="border-warning/40 bg-warning-soft">
          <TriangleAlertIcon aria-hidden className="text-warning-ink" />
          <AlertTitle>Not double-checked</AlertTitle>
          <AlertDescription>{document.checkError}</AlertDescription>
        </Alert>
        {listFlags && document.flags.length > 0 ? (
          <FlagList flags={document.flags} />
        ) : null}
      </>
    );
  }
  if (document.flags.length === 0 && document.edited) {
    return (
      <p className="flex items-start gap-2 text-xs text-success-ink">
        <ShieldCheckIcon aria-hidden className="size-4 shrink-0" />
        You made this version in the CV editor: every line is from your profile
        or from the version you edited.
      </p>
    );
  }
  if (document.flags.length === 0) {
    return document.checkedAt ? (
      <p className="flex items-start gap-2 text-xs text-success-ink">
        <ShieldCheckIcon aria-hidden className="size-4 shrink-0" />
        Every line cites your profile, and Claude checked each one against the
        facts it cites.
      </p>
    ) : null;
  }
  return listFlags ? <FlagList flags={document.flags} /> : null;
}

export function FlagList({
  flags,
  note = "These aren't backed by your profile, so they're not in the PDF or the copy buttons.",
}: {
  flags: ClaimFlag[];
  /** What leaving them out means where the list shows. */
  note?: string;
}) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden />
      <AlertTitle>
        {flags.length === 1
          ? "1 claim left out"
          : `${flags.length} claims left out`}
      </AlertTitle>
      <AlertDescription>
        <p>{note}</p>
        <ul className="mt-2 flex flex-col gap-2">
          {flags.map((flag) => (
            <li key={flag.itemId} className="flex flex-col gap-0.5">
              <span className="text-foreground line-through decoration-destructive/60">
                {flag.text}
              </span>
              <span>
                <Badge variant="destructive" className="mr-1">
                  {FLAG_LABELS[flag.kind]}
                </Badge>
                {flag.reason}
              </span>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function FlagNote({ flag }: { flag: ClaimFlag }) {
  return (
    <p className="mt-1 text-xs text-destructive">Left out: {flag.reason}</p>
  );
}

// ---------------------------------------------------------------------------
// CV
// ---------------------------------------------------------------------------

type CitedFact = { id: string; text: string };

/** The profile facts behind each bullet the CV shows, by its text. */
function citedFacts(diff: CvDiff): Map<string, CitedFact[]> {
  const facts = new Map<string, CitedFact[]>();
  for (const entry of diff.entries) {
    for (const bullet of entry.bullets) {
      if (!bullet.flag) facts.set(bullet.text, bullet.from);
    }
  }
  return facts;
}

function CvPanel({
  cv,
  jobId,
  company,
  canAddSkills,
}: {
  cv: NonNullable<ApplyKit["cv"]>;
  jobId: string;
  company: string;
  /** The kit can still be sent, and nothing is being written for it. */
  canAddSkills: boolean;
}) {
  const [view, setView] = useState<"cv" | "changes">("cv");
  const facts = useMemo(() => citedFacts(cv.diff), [cv.diff]);
  return (
    <>
      <Toolbar
        actions={
          <>
            <Link
              href={`/cvs/edit?kit=${cv.document.id}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <PencilIcon aria-hidden data-icon="inline-start" />
              Edit
            </Link>
            <PdfLinks document={cv.document} title={`CV for ${company}`} />
          </>
        }
        meta={<DocumentMeta document={cv.document} />}
      >
        <div
          role="group"
          aria-label="Show"
          className="flex gap-0.5 rounded-lg bg-muted p-0.5"
        >
          {(
            [
              ["cv", "Tailored CV"],
              ["changes", "Changes from your CV"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant="ghost"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className="text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs"
            >
              {label}
            </Button>
          ))}
        </div>
      </Toolbar>
      <div className={DESK}>
        <CheckSummary document={cv.document} />
        {cv.keywords.length > 0 ? (
          <section
            aria-labelledby="kit-keywords-heading"
            className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:p-4"
          >
            <h3 id="kit-keywords-heading" className="text-sm font-semibold">
              ATS keywords
            </h3>
            <KeywordCoverage
              keywords={cv.keywords}
              then="use Edit to put it on this CV"
              unused="Grey ones are in your profile but not on this CV. Edit adds back a line or skill that has them."
            />
            {canAddSkills && cv.skillsToAdd.length > 0 ? (
              <AddSkills
                jobId={jobId}
                documentId={cv.document.id}
                skills={cv.skillsToAdd}
              />
            ) : null}
          </section>
        ) : null}
        {view === "cv" ? (
          <>
            <p className="-mt-2 text-xs text-muted-foreground">
              Point at or select a line to see the facts it comes from.
            </p>
            <CvPaper cv={cv.view} facts={facts} />
          </>
        ) : (
          <CvChanges diff={cv.diff} />
        )}
      </div>
    </>
  );
}

const andList = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * One click to put the profile's skills that match missing keywords on the
 * CV, as its next version. Nothing else on the CV changes.
 */
function AddSkills({
  jobId,
  documentId,
  skills,
}: {
  jobId: string;
  documentId: string;
  skills: { id: string; name: string }[];
}) {
  const add = useAddCvSkills(jobId);
  const names = andList.format(skills.map((skill) => skill.name));
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="max-w-prose text-xs text-muted-foreground">
          Your profile lists{" "}
          <span className="font-medium text-foreground">{names}</span>, which
          this posting asks for. Add {skills.length === 1 ? "it" : "them"} to
          this CV&apos;s skills, with nothing else changed.
        </p>
        <Button
          size="sm"
          disabled={add.isPending}
          onClick={() =>
            add.mutate({
              documentId,
              skillIds: skills.map((skill) => skill.id),
            })
          }
        >
          {add.isPending ? (
            <Spinner aria-hidden data-icon="inline-start" />
          ) : (
            <PlusIcon aria-hidden data-icon="inline-start" />
          )}
          Add to CV
        </Button>
      </div>
      {add.error ? (
        <p role="alert" className="text-xs text-destructive">
          {add.error.message}
        </p>
      ) : null}
    </div>
  );
}

function CvPaper({
  cv,
  facts,
}: {
  cv: CvView;
  facts: Map<string, CitedFact[]>;
}) {
  const contact = [...cv.contact, ...cv.links.map((link) => link.label)];
  return (
    <article aria-label="The tailored CV" className={PAPER}>
      <header className="flex flex-col gap-1">
        <h3 className="text-2xl font-semibold tracking-tight">{cv.name}</h3>
        {cv.headline ? (
          <p className="text-sm font-medium text-primary">{cv.headline}</p>
        ) : null}
        {contact.length > 0 ? (
          <p className="text-xs text-muted-foreground">{contact.join(" · ")}</p>
        ) : null}
      </header>
      {cv.summary ? (
        <PaperSection title="Summary">
          <p>{cv.summary}</p>
        </PaperSection>
      ) : null}
      {cv.experience.length > 0 ? (
        <PaperSection title="Experience">
          {cv.experience.map((role) => (
            <PaperEntry
              key={role.id}
              title={`${role.title}, ${role.company}`}
              meta={role.dates}
              highlights={role.highlights}
              facts={facts}
            />
          ))}
        </PaperSection>
      ) : null}
      {cv.projects.length > 0 ? (
        <PaperSection title="Projects">
          {cv.projects.map((project) => (
            <PaperEntry
              key={project.id}
              title={project.name}
              meta={project.dates}
              highlights={project.highlights}
              facts={facts}
            />
          ))}
        </PaperSection>
      ) : null}
      {cv.skills.length > 0 ? (
        <PaperSection title="Skills">
          <p>{cv.skills.join(" · ")}</p>
        </PaperSection>
      ) : null}
      {cv.education.length > 0 ? (
        <PaperSection title="Education">
          {cv.education.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-wrap justify-between gap-x-4"
            >
              <span>
                <span className="font-medium">{entry.title}</span>
                {entry.title && entry.institution ? ", " : null}
                {entry.institution}
              </span>
              <span className="text-xs text-muted-foreground">
                {entry.dates}
              </span>
            </div>
          ))}
        </PaperSection>
      ) : null}
      {cv.certifications.length > 0 ? (
        <PaperSection title="Certifications">
          <p>{cv.certifications.join(" · ")}</p>
        </PaperSection>
      ) : null}
      {cv.languages.length > 0 ? (
        <PaperSection title="Languages">
          <p>{cv.languages.join(" · ")}</p>
        </PaperSection>
      ) : null}
    </article>
  );
}

function PaperSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h4 className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </h4>
      {children}
    </section>
  );
}

function PaperEntry({
  title,
  meta,
  highlights,
  facts,
}: {
  title: string;
  meta: string;
  highlights: string[];
  facts: Map<string, CitedFact[]>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">{meta}</span>
      </div>
      {highlights.length > 0 ? (
        <ul className="flex list-disc flex-col gap-0.5 pl-5 marker:text-muted-foreground">
          {highlights.map((highlight) => (
            <li key={highlight}>
              <CitedLine text={highlight} facts={facts.get(highlight) ?? []} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A CV line that shows the profile facts it cites, on hover or select. */
function CitedLine({ text, facts }: { text: string; facts: CitedFact[] }) {
  if (facts.length === 0) return <>{text}</>;
  return (
    <Popover>
      {/* Inline, so a line that wraps keeps its bullet on its first row. */}
      <PopoverTrigger
        openOnHover
        delay={400}
        closeDelay={150}
        nativeButton={false}
        render={<span />}
        className="-mx-1 cursor-help rounded px-1 outline-none [box-decoration-break:clone] hover:bg-primary/8 focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-primary/10"
      >
        {text}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-2 text-xs">
        <PopoverTitle className="text-xs font-medium text-muted-foreground">
          Comes from {facts.length === 1 ? "this fact" : "these facts"} in your
          profile
        </PopoverTitle>
        <ul className="flex flex-col gap-1.5">
          {facts.map((fact) => (
            <li key={fact.id} className="leading-snug">
              {fact.text}
            </li>
          ))}
        </ul>
        <Link
          href="/profile"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Open your profile
        </Link>
      </PopoverContent>
    </Popover>
  );
}

/** Text with the words added since the master CV marked, and removed ones struck. */
function DiffText({ parts }: { parts: DiffPart[] }) {
  return (
    <span>
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 ? " " : null}
          {part.kind === "added" ? (
            <ins className="rounded-sm bg-success-soft text-success-ink no-underline">
              <span className="sr-only">[added: </span>
              {part.text}
              <span className="sr-only">]</span>
            </ins>
          ) : part.kind === "removed" ? (
            <del className="rounded-sm bg-destructive-soft text-muted-foreground">
              <span className="sr-only">[removed: </span>
              {part.text}
              <span className="sr-only">]</span>
            </del>
          ) : (
            part.text
          )}
        </span>
      ))}
    </span>
  );
}

function CvChanges({ diff }: { diff: CvDiff }) {
  return (
    <div className="flex flex-col gap-5 rounded-lg border bg-card p-4 text-sm sm:p-6">
      <p className="text-xs text-muted-foreground">
        <ins className="rounded-sm bg-success-soft text-success-ink no-underline">
          New wording
        </ins>{" "}
        and{" "}
        <del className="rounded-sm bg-destructive-soft">removed wording</del>{" "}
        are marked against the line in your master CV each bullet rewords. Under
        each bullet are the profile facts it cites.
      </p>

      <section className="flex flex-col gap-1">
        <h4 className="font-medium">Summary</h4>
        {diff.summary.after === null ? (
          <p className="text-muted-foreground">No summary.</p>
        ) : diff.summary.changes ? (
          <DiffText parts={diff.summary.changes} />
        ) : (
          <p>{diff.summary.after}</p>
        )}
        {diff.summary.flag ? <FlagNote flag={diff.summary.flag} /> : null}
      </section>

      {diff.entries.map((entry) => (
        <section key={entry.id} className="flex flex-col gap-2">
          <h4 className="font-medium">{entry.title}</h4>
          {entry.bullets.length === 0 ? (
            <p className="text-muted-foreground">No bullets for this one.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {entry.bullets.map((bullet) => (
                <li
                  key={bullet.id}
                  className={cn(
                    "rounded-md border p-2.5",
                    bullet.flag && "border-destructive/40 bg-destructive/5",
                  )}
                >
                  {bullet.changes ? (
                    <DiffText parts={bullet.changes} />
                  ) : (
                    <span>{bullet.text}</span>
                  )}
                  {bullet.flag ? <FlagNote flag={bullet.flag} /> : null}
                  {bullet.from.length > 0 ? (
                    <details className="mt-1 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">
                        Cites {bullet.from.length}{" "}
                        {bullet.from.length === 1 ? "fact" : "facts"}
                      </summary>
                      <ul className="mt-1 list-disc pl-5">
                        {bullet.from.map((fact) => (
                          <li key={fact.id}>{fact.text}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {entry.leftOut.length > 0 ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                {entry.leftOut.length}{" "}
                {entry.leftOut.length === 1 ? "line" : "lines"} from your CV
                left out
              </summary>
              <ul className="mt-1 list-disc pl-5">
                {entry.leftOut.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ))}

      <section className="flex flex-col gap-1">
        <h4 className="font-medium">Skills</h4>
        <p>{diff.skills.shown.join(" · ") || "None listed."}</p>
        {diff.skills.leftOut.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Left out: {diff.skills.leftOut.join(", ")}
          </p>
        ) : null}
      </section>

      {diff.orphans.length > 0 ? <FlagList flags={diff.orphans} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cover letter
// ---------------------------------------------------------------------------

function LetterPanel({
  letter,
  company,
}: {
  letter: NonNullable<ApplyKit["letter"]>;
  company: string;
}) {
  const contact = [
    ...letter.view.contact,
    ...letter.view.links.map((link) => link.label),
  ];
  return (
    <>
      <Toolbar
        actions={
          <>
            <CopyButton text={letter.text} label="Copy letter" />
            <PdfLinks
              document={letter.document}
              title={`Cover letter for ${company}`}
            />
          </>
        }
      >
        <DocumentMeta document={letter.document} />
      </Toolbar>
      <div className={DESK}>
        <CheckSummary document={letter.document} />
        <article aria-label="The cover letter" className={PAPER}>
          <header className="flex flex-col gap-1">
            <h3 className="text-lg font-semibold tracking-tight">
              {letter.view.name}
            </h3>
            {contact.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {contact.join(" · ")}
              </p>
            ) : null}
          </header>
          <div className="flex flex-col gap-3.5">
            <p>{letter.view.greeting}</p>
            {letter.view.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <p className="whitespace-pre-line">
              {letter.view.closing}
              {"\n"}
              {letter.view.name}
            </p>
          </div>
        </article>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

const PAY_QUESTION = /salary|pay|compensation|rate/i;

function AnswersPanel({
  kit,
  answers,
}: {
  kit: ApplyKit;
  answers: NonNullable<ApplyKit["answers"]>;
}) {
  const { ready } = answerProgress(answers);
  const salary = kit.job.salary ? formatSalary(kit.job.salary) : null;
  return (
    <>
      <Toolbar
        actions={
          ready.length > 0 ? (
            <CopyButton
              text={answersText(answers)}
              label="Copy all"
              context="every answer that's ready"
            />
          ) : null
        }
      >
        <DocumentMeta
          document={answers.document}
          more={`${ready.length} of ${answers.items.length} ready`}
        />
      </Toolbar>
      <div className={DESK}>
        {answers.document.checkError ? (
          <CheckSummary document={answers.document} listFlags={false} />
        ) : null}
        <ol className="mx-auto flex w-full max-w-[46rem] flex-col gap-3">
          {answers.items.map((item) => (
            <AnswerCard
              key={item.id}
              jobId={kit.job.id}
              item={item}
              salary={PAY_QUESTION.test(item.question) ? salary : null}
            />
          ))}
        </ol>
      </div>
    </>
  );
}

function AnswerCard({
  jobId,
  item,
  salary,
}: {
  jobId: string;
  item: AnswerView;
  /** The posting's pay, when the question is about it. */
  salary: string | null;
}) {
  const ref = useRef<HTMLLIElement>(null);
  // Left to the owner, or left out because it didn't check out.
  const forYou = !item.answer || item.flag !== null;
  return (
    <li
      ref={ref}
      id={`answer-${item.id}`}
      tabIndex={-1}
      className={cn(
        "flex scroll-mt-24 flex-col gap-2 rounded-lg border bg-card p-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        forYou && "border-warning ring-1 ring-warning/30",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id={`answer-${item.id}-question`} className="font-medium">
          {item.question}
        </h3>
        {forYou ? null : (
          <CopyButton text={item.answer} size="xs" context={item.question} />
        )}
      </div>
      {item.flag ? (
        <div>
          <p className="text-muted-foreground line-through">{item.answer}</p>
          <FlagNote flag={item.flag} />
        </div>
      ) : item.answer ? (
        <>
          <p className="whitespace-pre-line">{item.answer}</p>
          {item.fromStandard ? (
            <p className="text-xs text-muted-foreground">
              From your standard answers
            </p>
          ) : null}
        </>
      ) : null}
      {forYou ? (
        <AnswerForm
          jobId={jobId}
          item={item}
          salary={salary}
          onSaved={() => ref.current?.focus()}
        />
      ) : null}
    </li>
  );
}

/**
 * The owner's answer to a question Claude left to them. It's saved to the
 * standard answers, so the kit shows it here and later kits can cite it.
 */
function AnswerForm({
  jobId,
  item,
  salary,
  onSaved,
}: {
  jobId: string;
  item: AnswerView;
  salary: string | null;
  onSaved: () => void;
}) {
  const save = useSaveKitAnswer(jobId);
  const form = useForm<SavedAnswer>({
    resolver: zodResolver(savedAnswerSchema),
    defaultValues: { question: item.question, answer: "" },
  });
  const submit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(values);
      toast.add({ title: "Saved to your standard answers", type: "success" });
      onSaved();
    } catch (error) {
      if (error instanceof ActionError) {
        applyServerErrors(form.setError, error.errors);
      } else {
        form.setError("root.server", {
          message: "Couldn't save the answer. Try again.",
        });
      }
    }
  });
  const fieldId = `answer-${item.id}-text`;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (save.isPending) return;
        form.clearErrors();
        void submit(event);
      }}
      className="flex flex-col gap-2.5"
    >
      <p className="flex items-start gap-1.5 text-warning-ink">
        <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          {item.flag
            ? "Write your own answer in its place."
            : `For you to answer. ${item.missing || "Your profile doesn't say."}`}
        </span>
      </p>
      <Controller
        control={form.control}
        name="answer"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid || undefined}>
            <Textarea
              {...field}
              id={fieldId}
              // Named by the question above it.
              aria-labelledby={`answer-${item.id}-question`}
              rows={2}
              placeholder={
                salary
                  ? "For example: EUR 70K–80K a year, open to discussing"
                  : "Your answer, as you'd put it on the form"
              }
              aria-invalid={fieldState.invalid || undefined}
              aria-describedby={
                fieldState.error
                  ? `${fieldId}-hint ${fieldId}-error`
                  : `${fieldId}-hint`
              }
            />
            <FieldDescription id={`${fieldId}-hint`}>
              {salary ? `The posting says ${salary}. ` : null}
              It&apos;s saved to your standard answers, so later kits can use it
              too.
            </FieldDescription>
            {fieldState.error ? (
              <FieldError id={`${fieldId}-error`} errors={[fieldState.error]} />
            ) : null}
          </Field>
        )}
      />
      {form.formState.errors.root?.server ? (
        <p role="alert" className="text-sm text-destructive">
          {form.formState.errors.root.server.message}
        </p>
      ) : null}
      {/* Not disabled while saving, so focus stays on it. */}
      <Button
        type="submit"
        size="sm"
        className="w-fit"
        aria-disabled={save.isPending || undefined}
      >
        {save.isPending ? "Saving…" : "Save answer"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Your details and the company
// ---------------------------------------------------------------------------

function DetailsPanel({ kit }: { kit: ApplyKit }) {
  return (
    <>
      <Toolbar>
        <span>
          For the form&apos;s usual fields, from your profile and standard
          answers.
        </span>
      </Toolbar>
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        {kit.standardAnswers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing saved yet.</p>
        ) : (
          <dl className="flex flex-col">
            {kit.standardAnswers.map((answer) => (
              <div
                key={answer.label}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 border-b py-2.5 text-sm last:border-b-0 sm:grid-cols-[10rem_minmax(0,1fr)_auto]"
              >
                <dt className="col-span-2 text-muted-foreground sm:col-span-1">
                  {answer.label}
                </dt>
                <dd className="whitespace-pre-line [overflow-wrap:anywhere]">
                  {answer.value}
                </dd>
                <CopyButton
                  text={answer.value}
                  size="xs"
                  variant="ghost"
                  context={answer.label}
                />
              </div>
            ))}
          </dl>
        )}
        {kit.missingAnswers.length > 0 ? (
          <p className="text-sm text-warning-ink">
            Not saved yet: {kit.missingAnswers.join(", ").toLowerCase()}.{" "}
            <Link
              href="/profile/answers"
              className="underline underline-offset-4"
            >
              Add them to your standard answers
            </Link>
          </p>
        ) : null}
      </div>
    </>
  );
}

function CompanyPanel({
  company,
  brief,
}: {
  company: string;
  brief: NonNullable<ApplyKit["brief"]>;
}) {
  return (
    <>
      <Toolbar>
        <span>
          What Claude found about {company} in a web search,{" "}
          <LocalDate iso={brief.createdAt} />.
        </span>
      </Toolbar>
      <div className="flex flex-col gap-4 p-4 text-sm sm:p-5">
        {/* Plain text: search results never render as HTML. */}
        <p className="max-w-prose whitespace-pre-line">{brief.text}</p>
        {brief.sources.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs">
            {brief.sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:underline"
                >
                  {source.title}
                  <ExternalLinkIcon aria-hidden className="size-3" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}
