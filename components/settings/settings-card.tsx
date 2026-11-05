import { useId } from "react";

import { cn } from "@/lib/utils";

/** One part of Settings: a titled card, with an optional footer row. */
export function SettingsCard({
  title,
  description,
  flush = false,
  footer,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  /** The body runs edge to edge, for a list with its own rules. */
  flush?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs"
    >
      <div className="px-4 pt-4 pb-3 sm:px-5">
        <h2 id={id} className="text-[0.9375rem] font-semibold">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div
        className={cn(
          "flex flex-col",
          !flush && "gap-5 px-4 pt-1 pb-5 sm:px-5",
        )}
      >
        {children}
      </div>
      {footer ? (
        <div className="border-t bg-muted/40 px-4 py-3 sm:px-5">{footer}</div>
      ) : null}
    </section>
  );
}
