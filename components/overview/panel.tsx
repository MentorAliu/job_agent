import { useId } from "react";

import { cn } from "@/lib/utils";

const ICON_TONES = {
  primary: "bg-primary-soft text-primary-ink",
  warning: "bg-warning-soft text-warning-ink",
  ready: "bg-status-ready-soft text-status-ready-ink",
} as const;

/**
 * One of the Overview's cards: a titled panel, with an icon, a count and an action
 * such as a link to the full list.
 */
export function Panel({
  title,
  icon,
  tone = "primary",
  count,
  description,
  action,
  className,
  children,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  tone?: keyof typeof ICON_TONES;
  count?: number;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex min-w-0 flex-col rounded-xl border bg-card shadow-xs",
        className,
      )}
    >
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 sm:px-5">
        {icon ? (
          <span
            aria-hidden
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-4.5",
              ICON_TONES[tone],
            )}
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2
            id={id}
            className="flex items-center gap-2 text-[0.9375rem] font-semibold"
          >
            {title}
            {count !== undefined ? (
              <span
                className={cn(
                  "rounded-full px-1.75 text-xs/5 font-semibold tabular-nums",
                  ICON_TONES[tone],
                )}
              >
                {count}
              </span>
            ) : null}
          </h2>
          {description ? (
            <p className="text-[0.8125rem] text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A card's text when it has nothing to list. */
export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-t px-4 py-6 text-center text-sm text-muted-foreground sm:px-5">
      {children}
    </p>
  );
}
