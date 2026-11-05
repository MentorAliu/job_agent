"use client";

import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** One part of a long form, such as Experience, with an optional Add button. */
export function FormSection({
  id,
  title,
  meta,
  description,
  addLabel,
  onAdd,
  flush = false,
  children,
}: {
  /** For the profile's "On this page" links. */
  id?: string;
  title: string;
  /** A short count beside the title, such as "5 roles". */
  meta?: React.ReactNode;
  description?: string;
  addLabel?: string;
  onAdd?: () => void;
  /** The body runs edge to edge, for a list of collapsible entries. */
  flush?: boolean;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      // ItemButtons finds the section's Add button through this.
      data-slot="card"
      className="flex min-w-0 scroll-mt-20 flex-col rounded-xl border bg-card shadow-xs"
    >
      <div className="flex items-start gap-3 px-4 pt-4 pb-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2
            id={headingId}
            className="flex flex-wrap items-baseline gap-x-2 text-[0.9375rem] font-semibold"
          >
            {title}
            {meta ? (
              <span className="text-[0.8125rem] font-normal text-muted-foreground">
                {meta}
              </span>
            ) : null}
          </h2>
          {description ? (
            <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {addLabel && onAdd ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-card"
            onClick={onAdd}
            data-add-button
          >
            <PlusIcon aria-hidden data-icon="inline-start" />
            {addLabel}
          </Button>
        ) : null}
      </div>
      <div
        className={cn(
          "flex flex-col",
          flush ? "border-t" : "gap-4 px-4 pt-1 pb-5 sm:px-5",
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** An entry in a list, such as one role, with move and remove buttons. */
export function ListItem({
  heading,
  index,
  count,
  onMove,
  onRemove,
  removeLabel,
  children,
}: {
  heading: string;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  removeLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-medium">{heading}</h3>
        <ItemButtons
          index={index}
          count={count}
          onMove={onMove}
          onRemove={onRemove}
          label={heading}
          removeLabel={removeLabel}
        />
      </div>
      {children}
    </div>
  );
}

export function ItemButtons({
  index,
  count,
  onMove,
  onRemove,
  label,
  removeLabel,
}: {
  index: number;
  count: number;
  onMove?: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  label: string;
  removeLabel: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {onMove && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
            aria-label={`Move ${label} up`}
          >
            <ArrowUpIcon aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === count - 1}
            onClick={() => onMove(index, index + 1)}
            aria-label={`Move ${label} down`}
          >
            <ArrowDownIcon aria-hidden />
          </Button>
        </>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={(event) => {
          const section = event.currentTarget.closest('[data-slot="card"]');
          onRemove(index);
          // The removed entry took this button with it: move focus to the
          // section's Add button rather than lose it.
          requestAnimationFrame(() => {
            if (document.activeElement !== document.body) return;
            section
              ?.querySelector<HTMLElement>("[data-add-button], button, input")
              ?.focus();
          });
        }}
        aria-label={removeLabel}
      >
        <Trash2Icon aria-hidden />
      </Button>
    </div>
  );
}

export function EmptyList({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)}>{children}</p>
  );
}
