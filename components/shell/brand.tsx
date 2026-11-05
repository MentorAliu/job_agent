import { cn } from "@/lib/utils";

/** The app's mark: its initials on the accent color. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-[0.6875rem] font-bold tracking-wide text-primary-foreground",
        className,
      )}
    >
      JA
    </span>
  );
}
