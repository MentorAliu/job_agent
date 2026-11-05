import { cn } from "@/lib/utils";

const TILE_LOOKS = [
  "bg-primary-soft text-primary-ink",
  "bg-status-ready-soft text-status-ready-ink",
  "bg-status-shortlisted-soft text-status-shortlisted-ink",
  "bg-success-soft text-success-ink",
  "bg-warning-soft text-warning-ink",
  "bg-status-applied-soft text-status-applied-ink",
];

/** The company's first letter on a tile, in a color that stays the same for it. */
export function CompanyTile({
  company,
  className,
}: {
  company: string;
  className?: string;
}) {
  let hash = 0;
  for (const char of company) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-xl text-lg font-bold",
        TILE_LOOKS[Math.abs(hash) % TILE_LOOKS.length],
        className,
      )}
    >
      {company.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
