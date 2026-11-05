import { SearchXIcon } from "lucide-react";
import Link from "next/link";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

// Shown inside the app shell for a role or run that doesn't exist, such as an
// old link to a role that was removed.
export default function AppNotFound() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>
          <h1 className="text-base">Not found</h1>
        </EmptyTitle>
        <EmptyDescription>
          There&apos;s nothing at this address. The link may be old, or the role
          or run may have been removed.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/jobs" className="underline underline-offset-4">
            Open Roles
          </Link>
          <Link href="/runs" className="underline underline-offset-4">
            See all runs
          </Link>
        </div>
      </EmptyContent>
    </Empty>
  );
}
