import { cn } from "@/lib/utils";

/** The top of a page: its title, a line on what it's for, and its actions. */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Above the title, such as a link back to the list. */
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow}
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <div className="max-w-prose text-sm text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
