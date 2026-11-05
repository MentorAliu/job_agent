import { CheckIcon } from "lucide-react";
import Link from "next/link";

import type { KeywordMatch } from "@/lib/cvs/keywords";
import { cn } from "@/lib/utils";

// The ATS keyword check on a CV, built or tailored: how many of the
// posting's keywords the CV uses, each as a chip, and what to do about the
// ones it doesn't.

export function KeywordCoverage({
  keywords,
  then,
  unused,
}: {
  keywords: KeywordMatch[];
  /** What gets a keyword added to the profile onto the CV, after "and". */
  then: string;
  /** What to say about keywords the profile has but the CV doesn't use. */
  unused?: React.ReactNode;
}) {
  const covered = keywords.filter((keyword) => keyword.onCv).length;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        <span className="font-semibold tabular-nums">
          {covered} of {keywords.length}
        </span>{" "}
        of the posting&apos;s keywords are on the CV.
      </p>
      <ul
        aria-label="The posting's keywords"
        className="flex flex-wrap gap-1.5"
      >
        {keywords.map((keyword) => (
          <li
            key={keyword.term}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 text-xs leading-5.5",
              keyword.onCv
                ? "border-success/30 bg-success-soft text-success-ink"
                : keyword.inProfile
                  ? "bg-muted text-muted-foreground"
                  : "border-dashed text-muted-foreground",
            )}
          >
            {keyword.onCv ? <CheckIcon aria-hidden className="size-3" /> : null}
            {keyword.term}
            <span className="sr-only">
              {keyword.onCv
                ? ", on the CV"
                : keyword.inProfile
                  ? ", in your profile but not on this CV"
                  : ", not in your profile"}
            </span>
          </li>
        ))}
      </ul>
      {unused &&
      keywords.some((keyword) => keyword.inProfile && !keyword.onCv) ? (
        <p className="text-xs text-muted-foreground">{unused}</p>
      ) : null}
      {keywords.some((keyword) => !keyword.onCv && !keyword.inProfile) ? (
        <p className="text-xs text-muted-foreground">
          Dashed ones aren&apos;t in your profile, so the CV can&apos;t claim
          them. If one is true, add it on the{" "}
          <Link
            href="/profile"
            className="font-medium text-primary-ink underline-offset-4 hover:underline"
          >
            Profile
          </Link>{" "}
          page and {then}.
        </p>
      ) : null}
    </div>
  );
}
