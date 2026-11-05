import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";

/** Above an editor's title: the way back to the profile summary. */
export function BackToProfile() {
  return (
    <Link
      href="/profile"
      className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ArrowLeftIcon aria-hidden className="size-4" />
      Profile
    </Link>
  );
}
