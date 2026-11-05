"use client";

import { ChevronDownIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { CompanyTile } from "@/components/jobs/company-tile";
import { cn } from "@/lib/utils";

import { ItemButtons } from "./form-parts";

/** What a closed entry shows: a tile, what it is, and a short count. */
export function ItemSummary({
  tile,
  title,
  subtitle,
  meta,
}: {
  /** The tile's letter comes from this, such as the company. */
  tile: string;
  title: string;
  subtitle?: string;
  /** Such as "4 bullets". */
  meta?: string;
}) {
  return (
    <>
      <CompanyTile company={tile} className="size-9 rounded-lg text-sm" />
      <span className="min-w-0 flex-1">
        {/* Phones wrap rather than cut off, as the move buttons leave little room. */}
        <span className="block text-sm font-semibold break-words group-hover/item:underline group-hover/item:underline-offset-4 sm:truncate">
          {title}
        </span>
        {subtitle ? (
          <span className="block text-[0.8125rem] break-words text-muted-foreground sm:truncate">
            {subtitle}
          </span>
        ) : null}
      </span>
      {meta ? (
        <span className="text-xs whitespace-nowrap text-muted-foreground group-data-invalid/item:hidden max-sm:hidden">
          {meta}
        </span>
      ) : null}
    </>
  );
}

/**
 * One entry in a list, such as a role: a row that says what it is, and opens
 * to edit it. Closed entries stay in the form, just hidden, and an entry with
 * a field to fix stays open.
 */
export function CollapsibleItem({
  summary,
  label,
  defaultOpen = false,
  invalid = false,
  index,
  count,
  onMove,
  onRemove,
  children,
}: {
  /** The row's content, usually an `ItemSummary`. */
  summary: React.ReactNode;
  /** Names the entry in the move and remove buttons. */
  label: string;
  defaultOpen?: boolean;
  invalid?: boolean;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  children: React.ReactNode;
}) {
  const [opened, setOpened] = useState(defaultOpen);
  const open = opened || invalid;
  const contentId = useId();

  return (
    <div className="border-t first:border-t-0">
      {/* On a phone the move and remove buttons drop below the row. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 sm:px-5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          data-invalid={invalid || undefined}
          onClick={() => setOpened(!open)}
          className="group/item flex min-w-0 flex-[1_1_16rem] items-center gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {summary}
          {invalid ? (
            <span className="text-xs font-medium whitespace-nowrap text-destructive-ink">
              Needs fixing
            </span>
          ) : null}
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
        {open ? (
          <div className="ml-auto">
            <ItemButtons
              index={index}
              count={count}
              onMove={onMove}
              onRemove={onRemove}
              label={label}
              removeLabel={`Remove ${label}`}
            />
          </div>
        ) : null}
      </div>
      <div
        id={contentId}
        hidden={!open}
        className="flex flex-col gap-4 px-4 pb-5 sm:px-5 md:pl-17"
      >
        {children}
      </div>
    </div>
  );
}

export type SectionLink = {
  id: string;
  label: string;
  /** How many entries the part has. Left out for Basics. */
  count?: number;
};

/** How far below the top of the window a part counts as the one being read. */
const READING_LINE = 140;

/**
 * The profile's "On this page" list, with how many entries each part has.
 * The part being read is marked as the page scrolls.
 */
export function SectionMenu({ sections }: { sections: SectionLink[] }) {
  const [active, setActive] = useState<string | undefined>(sections[0]?.id);
  const ids = sections.map((section) => section.id).join(" ");

  useEffect(() => {
    const list = ids.split(" ");
    const onScroll = () => {
      const page = document.scrollingElement;
      // At the very end the last parts can't reach the line, so the last one wins.
      if (page && page.scrollTop + page.clientHeight >= page.scrollHeight - 4) {
        setActive(list.at(-1));
        return;
      }
      let current = list[0];
      for (const id of list) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= READING_LINE) current = id;
      }
      setActive(current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [ids]);

  return (
    <nav aria-label="On this page" className="flex flex-col">
      <p className="px-2.5 pb-2 text-xs font-medium text-muted-foreground">
        On this page
      </p>
      <ul className="flex flex-col gap-0.5">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              aria-current={active === section.id ? "location" : undefined}
              className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current]:bg-muted aria-[current]:font-semibold aria-[current]:text-foreground"
            >
              {section.label}
              {section.count === undefined ? null : (
                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                  {section.count === 0 ? "None yet" : section.count}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Why the profile matters: tailored documents can only use what's in it. */
export function FactsNote() {
  return (
    <p className="flex gap-2.5 rounded-xl bg-primary-soft p-3.5 text-[0.8125rem] leading-relaxed text-primary-ink">
      <ShieldCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        Claude only uses what&apos;s here. Every line it writes for an
        application cites one of these facts, and a line that can&apos;t is
        flagged before you send.
      </span>
    </p>
  );
}
