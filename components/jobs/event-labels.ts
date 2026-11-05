import { OUTCOME_LABELS, OUTCOME_STATUSES } from "@/components/emails/labels";
import type { DocumentKind } from "@/lib/schemas/tailor";
import type { JobEvent } from "@/lib/schemas/tracker";

import { DOCUMENT_LABELS, formatShortDay, STATUS_LABELS } from "./labels";
import { statusDot } from "./status-pill";

// How a role's timeline events read, on the role page and in the Overview's
// feed.

/** "CV v2, cover letter v1 and answers v1" */
export function documentList(
  documents: { kind: DocumentKind; version: number }[],
): string {
  const named = documents.map(
    ({ kind, version }) => `${DOCUMENT_LABELS[kind]} v${version}`,
  );
  const text =
    named.length > 1
      ? `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`
      : (named[0] ?? "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type EventEntry = { title: string; detail: string | null; dot: string };

export function describeEvent(event: JobEvent, today: string): EventEntry {
  switch (event.type) {
    case "status_changed": {
      const { from, to, reason, source } = event.payload;
      const why = reason || `From ${STATUS_LABELS[from]}`;
      return {
        title: STATUS_LABELS[to],
        detail:
          source === "email"
            ? `Changed by an email. ${reason ? `“${reason}”` : why}`
            : source === "no_reply" || source === "listing"
              ? `Changed by the app. ${reason ?? ""}`.trim()
              : why,
        dot: statusDot(to),
      };
    }
    case "email_added": {
      const { author, outcome, summary, sure } = event.payload;
      const unsure = author === "employer" && outcome !== "unrelated" && !sure;
      return {
        title:
          author === "candidate"
            ? "You replied"
            : unsure
              ? "Email to check"
              : `Email: ${OUTCOME_LABELS[outcome].toLowerCase()}`,
        detail: [
          summary || null,
          unsure
            ? "Claude wasn't sure what it means, so the status stays."
            : null,
        ]
          .filter(Boolean)
          .join(" "),
        dot:
          author === "candidate"
            ? "bg-neutral"
            : unsure
              ? "bg-warning"
              : statusDot(OUTCOME_STATUSES[outcome]),
      };
    }
    case "follow_up_set":
      return {
        title: `Follow-up set for ${formatShortDay(event.payload.on, today)}`,
        detail: null,
        dot: "bg-warning",
      };
    case "follow_up_cleared":
      return {
        title: `Follow-up for ${formatShortDay(event.payload.was, today)} cleared`,
        detail: null,
        dot: "bg-neutral",
      };
    case "documents_ready":
      return {
        title: event.payload.edited
          ? "CV edited by you"
          : event.payload.note
            ? "Kit written again"
            : "Kit ready",
        detail: documentList(event.payload.documents),
        dot: statusDot("ready"),
      };
    case "documents_sent":
      return {
        title: "Sent with the application",
        detail: documentList(event.payload.documents),
        dot: statusDot("applied"),
      };
  }
}
