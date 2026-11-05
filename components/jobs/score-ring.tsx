import { cn } from "@/lib/utils";

const SIZES = {
  sm: "size-8 text-[0.6875rem]",
  md: "size-10 text-[0.8125rem]",
  lg: "size-14 text-lg",
} as const;

/** Green from 80, amber from 65, grey below: the same bands everywhere. */
export function scoreTone(score: number): "good" | "fair" | "low" {
  if (score >= 80) return "good";
  if (score >= 65) return "fair";
  return "low";
}

const TONES = {
  good: { stroke: "stroke-success", text: "text-success-ink" },
  fair: { stroke: "stroke-warning", text: "text-warning-ink" },
  low: { stroke: "stroke-neutral", text: "text-muted-foreground" },
} as const;

/** A 0 to 100 match score inside a ring that fills to the score. */
export function ScoreRing({
  score,
  size = "md",
  className,
}: {
  score: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const tone = TONES[scoreTone(score)];
  return (
    <span
      role="img"
      aria-label={`Match score ${score} of 100`}
      className={cn(
        "relative inline-grid shrink-0 place-items-center rounded-full font-semibold tabular-nums",
        SIZES[size],
        tone.text,
        className,
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 36 36"
        className="absolute inset-0 size-full -rotate-90"
      >
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          strokeWidth="3"
          className="stroke-track"
        />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${Math.min(100, Math.max(0, score))} 100`}
          className={tone.stroke}
        />
      </svg>
      <span aria-hidden className="relative">
        {score}
      </span>
    </span>
  );
}
