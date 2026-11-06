"use client";

import {
  CircleCheckIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  ListChecksIcon,
  MailIcon,
  PenLineIcon,
  SendIcon,
  type LucideIcon,
} from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import { formatCost } from "@/components/runs/run-labels";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ApplyKit, KitDocument } from "@/lib/dal/apply-kit";
import { answerProgress, answersText } from "@/lib/jobs/kit-steps";
import { cn } from "@/lib/utils";

import { documentList } from "./event-labels";
import { DOCUMENT_LABELS, outboundRel } from "./labels";
import { LocalDate } from "./local-date";

// The apply kit's side panel: what's in the kit, with a download or a copy
// for each part, then Open the application and Mark as applied. On a phone
// the two buttons stay at the bottom of the screen.

function applyUrl(kit: ApplyKit): string {
  return kit.job.applyUrl ?? kit.job.url;
}

/** "PDF ready · every line checked", or what's missing. */
export function documentDetail(document: KitDocument, ready: string): string {
  if (document.checkError) return `${ready} · not double-checked`;
  if (document.flags.length > 0) {
    return `${ready} · ${document.flags.length} left out`;
  }
  return document.checkedAt ? `${ready} · every line checked` : ready;
}

function KitRow({
  icon: Icon,
  title,
  detail,
  attention = false,
  action,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  attention?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 border-b py-3 last:border-b-0 last:pb-0">
      <span
        aria-hidden
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4",
          attention
            ? "bg-warning-soft text-warning-ink"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p
          className={cn(
            "text-xs",
            attention ? "text-warning-ink" : "text-muted-foreground",
          )}
        >
          {detail}
        </p>
      </div>
      {action}
    </li>
  );
}

/** The kit's three parts, each with its download or copy. */
function KitParts({ kit, onAnswer }: { kit: ApplyKit; onAnswer: () => void }) {
  const cv = kit.cv?.document;
  const letter = kit.letter;
  const { ready, forYou } = answerProgress(kit.answers);
  const total = kit.answers?.items.length ?? 0;
  return (
    <ul className="flex flex-col">
      <KitRow
        icon={FileTextIcon}
        title="CV"
        detail={
          !cv
            ? "Not written yet"
            : cv.pdfUrl
              ? documentDetail(cv, "PDF ready")
              : "The PDF isn't drawn yet"
        }
        action={
          cv?.pdfUrl ? (
            <a
              href={cv.pdfUrl}
              download
              className={cn(buttonVariants({ variant: "outline", size: "xs" }))}
            >
              <DownloadIcon aria-hidden data-icon="inline-start" />
              Download<span className="sr-only"> the CV</span>
            </a>
          ) : null
        }
      />
      <KitRow
        icon={MailIcon}
        title="Cover letter"
        detail={
          letter
            ? documentDetail(
                letter.document,
                `${letter.view.paragraphs.length} paragraphs`,
              )
            : "Not written yet"
        }
        action={
          letter ? (
            <CopyButton
              text={letter.text}
              size="xs"
              context={DOCUMENT_LABELS.cover_letter}
            />
          ) : null
        }
      />
      <KitRow
        icon={ListChecksIcon}
        title="Answers"
        detail={
          !kit.answers
            ? "Not written yet"
            : forYou.length > 0
              ? `${ready.length} of ${total} ready · ${forYou.length} only you can answer`
              : `${ready.length} of ${total} ready`
        }
        attention={forYou.length > 0}
        action={
          forYou.length > 0 ? (
            <Button variant="outline" size="xs" onClick={onAnswer}>
              <PenLineIcon aria-hidden data-icon="inline-start" />
              Answer
            </Button>
          ) : kit.answers ? (
            <CopyButton
              text={answersText(kit.answers)}
              size="xs"
              context="every answer"
            />
          ) : null
        }
      />
    </ul>
  );
}

/**
 * What's in the kit and the two buttons that send it. Once applied, what
 * was sent instead.
 */
export function SendPanel({
  kit,
  active,
  marking,
  onMarkApplied,
  onAnswer,
}: {
  kit: ApplyKit;
  /** Tailoring is going, so nothing can be marked as sent yet. */
  active: boolean;
  /** Mark as applied is saving. */
  marking: boolean;
  onMarkApplied: () => void;
  /** Opens the answers at the first one left to the owner. */
  onAnswer: () => void;
}) {
  if (kit.application) return <Applied kit={kit} />;
  return (
    <section
      id="send"
      aria-labelledby="send-heading"
      className="scroll-mt-20 rounded-xl border bg-card p-5"
    >
      <h2 id="send-heading" className="font-semibold">
        Your kit
      </h2>
      <div className="mt-2">
        <KitParts kit={kit} onAnswer={onAnswer} />
      </div>
      <div className="mt-5 flex flex-col gap-2 max-lg:hidden">
        <a
          href={applyUrl(kit)}
          target="_blank"
          rel={outboundRel(applyUrl(kit))}
          className={cn(buttonVariants({ variant: "outline" }), "w-full")}
        >
          Open the application
          <ExternalLinkIcon aria-hidden data-icon="inline-end" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <MarkAppliedButton
          active={active}
          marking={marking}
          onMarkApplied={onMarkApplied}
          className="w-full"
        />
        <p className="text-center text-xs text-balance text-muted-foreground">
          Send it on the employer&apos;s site, then mark it here. Claude never
          submits for you.
        </p>
      </div>
    </section>
  );
}

function MarkAppliedButton({
  active,
  marking,
  onMarkApplied,
  className,
}: {
  active: boolean;
  marking: boolean;
  onMarkApplied: () => void;
  className?: string;
}) {
  return (
    <Button
      className={className}
      onClick={onMarkApplied}
      disabled={active || marking}
    >
      {marking ? (
        <Spinner aria-hidden data-icon="inline-start" />
      ) : (
        <SendIcon aria-hidden data-icon="inline-start" />
      )}
      Mark as applied
    </Button>
  );
}

/** What was sent, once the role is marked as applied. */
function Applied({ kit }: { kit: ApplyKit }) {
  const application = kit.application!;
  return (
    <section
      id="send"
      className="flex scroll-mt-20 flex-col gap-2 rounded-xl border bg-card p-5"
    >
      <div className="flex items-center gap-2.5">
        <CircleCheckIcon aria-hidden className="size-5 text-success" />
        <h2 className="font-semibold">
          Applied on <LocalDate iso={application.appliedAt} />
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">
        {application.documents.length > 0
          ? `You sent ${documentList(application.documents)}.`
          : "No tailored documents were recorded with it."}
      </p>
    </section>
  );
}

/** Open the application and Mark as applied, kept in reach on a phone. */
export function PhoneApplyBar({
  kit,
  active,
  marking,
  onMarkApplied,
}: {
  kit: ApplyKit;
  active: boolean;
  marking: boolean;
  onMarkApplied: () => void;
}) {
  if (kit.application) return null;
  return (
    <div
      data-bottom-bar
      className="sticky bottom-(--tab-bar-height) z-10 -mx-4 flex flex-col gap-1 border-t bg-background/95 px-4 pt-3 pb-1.5 backdrop-blur sm:-mx-6 sm:px-6 md:bottom-0 lg:hidden"
    >
      <div className="grid grid-cols-2 gap-2">
        <a
          href={applyUrl(kit)}
          target="_blank"
          rel={outboundRel(applyUrl(kit))}
          className={cn(buttonVariants({ variant: "outline" }), "h-11")}
        >
          Open application
          <ExternalLinkIcon aria-hidden data-icon="inline-end" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <MarkAppliedButton
          active={active}
          marking={marking}
          onMarkApplied={onMarkApplied}
          className="h-11"
        />
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Claude never submits for you.
      </p>
    </div>
  );
}

export function PostingAsks({ rules }: { rules: string[] }) {
  if (rules.length === 0) return null;
  return (
    <section
      aria-labelledby="posting-asks-heading"
      className="rounded-xl border bg-card p-5"
    >
      <h2 id="posting-asks-heading" className="text-sm font-semibold">
        What the posting asks for
      </h2>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm marker:text-muted-foreground">
        {rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </section>
  );
}

/** What tailoring the role cost, and the way to its facts and timeline. */
export function KitFooter({ costUsd }: { costUsd: number }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-5 py-3 text-sm">
      <span className="text-muted-foreground">
        {costUsd > 0 ? (
          <>
            This kit cost{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {formatCost(costUsd)}
            </span>
          </>
        ) : (
          "Nothing spent on this kit yet"
        )}
      </span>
      <a
        href="#role-details"
        className="font-medium text-primary underline-offset-4 hover:underline"
      >
        Facts and timeline
      </a>
    </div>
  );
}
