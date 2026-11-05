"use client";

import { EllipsisVerticalIcon, PencilIcon } from "lucide-react";
import Link from "next/link";

import { PdfThumbnail } from "@/components/documents/pdf-thumbnail";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// One CV on the CVs page, as a file browser shows a document: its first
// page, its name and date, and a menu. The whole card opens it.

/** What the card's preview shows. */
export type CardPreview =
  | { kind: "pdf"; url: string }
  | { kind: "busy"; label: string }
  | { kind: "failed" }
  | { kind: "file"; label: string };

/** What opening the card does. */
export type CardOpen =
  | { kind: "link"; href: string }
  | { kind: "button"; onOpen: () => void }
  | { kind: "download"; href: string };

const OPEN =
  "truncate rounded-sm text-left text-sm font-semibold outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline";

function OpenControl({ open, title }: { open: CardOpen; title: string }) {
  switch (open.kind) {
    case "link":
      return (
        <Link href={open.href} className={OPEN} title={title} data-card-open>
          {title}
        </Link>
      );
    case "download":
      // A link, not a button: it downloads a file.
      return (
        <a
          href={open.href}
          download
          className={OPEN}
          title={title}
          data-card-open
        >
          {title}
        </a>
      );
    case "button":
      return (
        <button
          type="button"
          onClick={open.onOpen}
          className={OPEN}
          title={title}
          data-card-open
        >
          {title}
        </button>
      );
  }
}

function Preview({ preview }: { preview: CardPreview }) {
  switch (preview.kind) {
    case "pdf":
      return (
        <PdfThumbnail
          url={preview.url}
          className="rounded-t-sm shadow-sm ring-1 ring-black/5"
        />
      );
    case "busy":
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 rounded-t-sm bg-card text-xs font-medium text-primary-ink ring-1 ring-black/5">
          <Spinner aria-hidden className="size-5 text-primary" />
          {preview.label}
        </div>
      );
    case "failed":
      return (
        <div className="flex h-full items-center justify-center rounded-t-sm bg-card px-3 text-center text-xs font-medium text-destructive ring-1 ring-black/5">
          This CV didn&apos;t finish
        </div>
      );
    case "file":
      return (
        <div className="flex h-full items-center justify-center rounded-t-sm bg-card px-3 text-center text-xs text-muted-foreground ring-1 ring-black/5">
          {preview.label}
        </div>
      );
  }
}

export function CvCard({
  title,
  subtitle,
  date,
  icon,
  preview,
  open,
  editHref,
  menuLabel,
  menu,
}: {
  title: string;
  subtitle: React.ReactNode;
  date: React.ReactNode;
  /** A small tile before the name: a file or a company. */
  icon: React.ReactNode;
  preview: CardPreview;
  open: CardOpen;
  /** Where Edit goes, when the CV can be edited now. */
  editHref?: string;
  /** Names the menu button, such as "More for Senior Frontend Engineer". */
  menuLabel: string;
  /** The menu's items. */
  menu: React.ReactNode;
}) {
  return (
    <li className="group/card relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md has-[[data-card-open]:focus-visible]:ring-3 has-[[data-card-open]:focus-visible]:ring-ring/50">
      <div className="relative h-40 overflow-hidden border-b bg-muted/60 px-4 pt-4 sm:h-48">
        <Preview preview={preview} />
        {editHref ? (
          <Link
            href={editHref}
            className={cn(
              buttonVariants({ size: "sm" }),
              "absolute right-3 bottom-3 z-10 shadow-md transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within/card:opacity-100 pointer-fine:group-hover/card:opacity-100",
            )}
          >
            <PencilIcon aria-hidden data-icon="inline-start" />
            Edit
            <span className="sr-only"> {title}</span>
          </Link>
        ) : null}
      </div>
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {icon}
        <div className="flex min-w-0 flex-1 flex-col">
          <OpenControl open={open} title={title} />
          <span className="truncate text-xs text-muted-foreground">
            {subtitle}
          </span>
          <span className="truncate text-xs text-muted-foreground tabular-nums">
            {date}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="relative z-10 -mr-1 shrink-0"
                aria-label={menuLabel}
              />
            }
          >
            <EllipsisVerticalIcon aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {menu}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
