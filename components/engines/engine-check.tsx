"use client";

import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { LocalDate } from "@/components/jobs/local-date";
import { useAfter } from "@/components/use-after";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { isCheckActive } from "@/lib/setup/queries";
import {
  CHECK_PICKUP_WAIT_MS,
  type EngineCheckFailure,
  type EngineCheckView,
} from "@/lib/schemas/setup";
import {
  ENGINE_NAMES,
  isCliEngine,
  type AgentEngine,
} from "@/lib/schemas/settings";

import { checkTicks, type TickState } from "./check-ticks";
import type { Runner } from "./engine-connect";

/** What the owner can do about each kind of failure. */
function failureHint(
  failure: EngineCheckFailure | null,
  engine: AgentEngine,
  runner: Runner,
): string | null {
  const name = ENGINE_NAMES[engine];
  switch (failure) {
    case "setup":
      return engine === "claude_code"
        ? "Add the token as shown above, restart the app, then check again."
        : `Connect ${name} above first.`;
    case "login":
      return engine === "claude_code"
        ? "Make a new token with claude setup-token, put it in the app's environment, restart the app, then check again."
        : `Sign ${name} in again above, then check again.`;
    case "limit":
      return "Wait for the limit to reset, add credit, or pick another provider.";
    case "busy":
      return "Try again in a minute.";
    case "sandbox":
      return runner === "vercel-sandbox"
        ? "The Vercel Sandbox couldn't start the agent. Check the project's Sandbox allowance, then try again."
        : `${name} couldn't start where the app runs. Rebuild the app (docker compose --profile app up -d --build), or for pnpm dev install ${name} on this computer.`;
    case "budget":
      return "Raise the monthly budget in Settings, or pick Claude Code or Codex, which cost nothing against it.";
    case "worker":
      return "The background worker (Inngest) runs every agent step. Start it (docker compose --profile app up -d, or docker compose --profile dev up -d for pnpm dev), then check again.";
    default:
      return null;
  }
}

const TICK_ICONS: Record<TickState, React.ReactNode> = {
  done: (
    <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-success-ink" />
  ),
  running: <Spinner aria-hidden className="shrink-0" />,
  failed: (
    <CircleXIcon aria-hidden className="size-4 shrink-0 text-destructive-ink" />
  ),
  waiting: (
    <CircleDashedIcon
      aria-hidden
      className="size-4 shrink-0 text-muted-foreground"
    />
  ),
};

const TICK_WORDS: Record<TickState, string> = {
  done: "done",
  running: "in progress",
  failed: "failed",
  waiting: "not yet",
};

/**
 * Check it works: one tiny real call on the engine, and how the last one
 * went. `stale` says the sign-in or key changed after the last check passed.
 * `onPickAnother`, for setup, offers another provider when it failed.
 */
export function EngineCheckPanel({
  engine,
  check,
  ready,
  runner,
  pending,
  error,
  stale = false,
  onCheck,
  onPickAnother,
}: {
  engine: AgentEngine;
  check: EngineCheckView | null;
  /** The engine is signed in, or has its key, so a check can run. */
  ready: boolean;
  runner: Runner;
  /** The check is being started. */
  pending: boolean;
  /** Why the check couldn't be started. */
  error: string | null;
  stale?: boolean;
  onCheck: () => void;
  onPickAnother?: () => void;
}) {
  const name = ENGINE_NAMES[engine];
  const running = pending || isCheckActive(check);
  const waiting = useAfter(
    check && check.status === "queued" ? check.createdAt : null,
    CHECK_PICKUP_WAIT_MS,
  );
  const passed = check?.status === "passed" && !stale;
  const failed = !running && (Boolean(error) || check?.status === "failed");

  let status: React.ReactNode;
  if (running) {
    status = (
      <p className="text-[0.8125rem] text-muted-foreground">
        Checking {name}…{" "}
        {isCliEngine(engine)
          ? "It starts the agent the way every step does, so it can take a minute or two."
          : "This takes a few seconds."}
        {waiting ? (
          <>
            {" "}
            Still waiting for the background worker. Check that Inngest is
            running (docker compose --profile dev up -d for pnpm dev, or docker
            compose --profile app up -d).
          </>
        ) : null}
      </p>
    );
  } else if (error) {
    status = (
      <p className="flex items-start gap-2 text-[0.8125rem]">
        <TriangleAlertIcon
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-destructive-ink"
        />
        <span>{error}</span>
      </p>
    );
  } else if (check?.status === "passed") {
    status = (
      <p className="text-[0.8125rem]">
        {stale ? (
          <>
            {name} worked when last checked, but its sign-in changed since.
            Check it again.
          </>
        ) : (
          <>
            <span className="font-medium">{name} works.</span>{" "}
            {check.finishedAt ? (
              <span className="text-muted-foreground">
                Checked <LocalDate iso={check.finishedAt} withTime />.
              </span>
            ) : null}
          </>
        )}
      </p>
    );
  } else if (check?.status === "failed") {
    const hint = failureHint(check.failure, engine, runner);
    status = (
      <div className="flex flex-col gap-1 text-[0.8125rem]">
        <p>
          <span className="font-medium">{name} didn&apos;t work.</span>{" "}
          {check.message}
        </p>
        {hint ? <p className="text-muted-foreground">{hint}</p> : null}
      </div>
    );
  } else {
    status = (
      <p className="flex items-start gap-2 text-[0.8125rem] text-muted-foreground">
        <CircleDashedIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        {ready
          ? `Not checked yet. The check makes one tiny call on ${name}, the way the agents do.`
          : `Connect ${name} above, then check it.`}
      </p>
    );
  }

  const ticks =
    check || pending
      ? checkTicks({ engine, check, ready, pending, stale })
      : null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Check it works</p>
        <div className="flex flex-wrap items-center gap-2">
          {failed && onPickAnother ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onPickAnother}
            >
              Pick another
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={passed ? "outline" : "default"}
            disabled={!ready || running}
            onClick={onCheck}
          >
            {running ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : check ? (
              <RefreshCwIcon aria-hidden data-icon="inline-start" />
            ) : null}
            {check ? "Check again" : "Check it works"}
          </Button>
        </div>
      </div>
      <div role="status" aria-live="polite" className="flex flex-col gap-2.5">
        {ticks ? (
          <ul className="flex flex-col gap-1.5 text-[0.8125rem]">
            {ticks.map((tick) => (
              <li key={tick.label} className="flex items-center gap-2">
                {TICK_ICONS[tick.state]}
                <span
                  className={
                    tick.state === "waiting" ? "text-muted-foreground" : ""
                  }
                >
                  {tick.label}
                  <span className="sr-only">: {TICK_WORDS[tick.state]}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {status}
      </div>
    </div>
  );
}
