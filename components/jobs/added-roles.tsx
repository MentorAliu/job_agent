import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import Link from "next/link";

import { Spinner } from "@/components/ui/spinner";
import { roleHref } from "@/lib/applications/progress";
import type { AddedRoleView } from "@/lib/dal/added-roles";

// The roles the owner added in the past day, above the Roles list, so they
// can see each one being read and where it went. The top bar refreshes the
// page once Claude is done with them.

export function AddedRoles({ roles }: { roles: AddedRoleView[] }) {
  if (roles.length === 0) return null;
  return (
    <section
      aria-labelledby="added-roles-title"
      className="flex flex-col gap-2"
    >
      <h2 id="added-roles-title" className="text-sm font-medium">
        Roles you added
      </h2>
      <ul className="flex flex-col divide-y rounded-xl border bg-card">
        {roles.map((added) => (
          <li key={added.id} className="flex min-w-0 gap-3 px-4 py-3">
            <StatusIcon status={added.status} />
            <div className="flex min-w-0 flex-col gap-0.5">
              {added.role ? (
                <Link
                  href={roleHref(added.role)}
                  className="truncate font-medium underline-offset-4 hover:underline"
                >
                  {added.role.title} at {added.role.company}
                </Link>
              ) : (
                <span className="truncate font-medium">{added.site}</span>
              )}
              <p className="text-sm text-muted-foreground">
                {added.status === "reading"
                  ? "Claude is reading the posting."
                  : (added.note ??
                    (added.status === "done" ? "Added." : "Couldn't add it."))}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusIcon({ status }: { status: AddedRoleView["status"] }) {
  const className = "mt-0.5 size-4 shrink-0";
  switch (status) {
    case "reading":
      return (
        <Spinner aria-label="Reading" className={`${className} text-primary`} />
      );
    case "done":
      return (
        <CircleCheckIcon
          aria-label="Added"
          className={`${className} text-success-ink`}
        />
      );
    case "failed":
      return (
        <CircleAlertIcon
          aria-label="Not added"
          className={`${className} text-destructive`}
        />
      );
  }
}
