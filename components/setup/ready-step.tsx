"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, CircleCheckIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { finishSetupAction } from "@/app/setup/actions";
import { SENIORITY_LABELS } from "@/components/jobs/labels";
import { count } from "@/components/profile/format";
import {
  TimeZoneSelect,
  useBrowserTimeZone,
} from "@/components/time-zone-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { callAction } from "@/lib/call-action";
import type { SetupState } from "@/lib/dal/setup";
import type { WantedFocus } from "@/lib/schemas/profile";
import type { SetupStep } from "@/lib/schemas/setup";
import { ENGINE_NAMES } from "@/lib/schemas/settings";
import { setupKey } from "@/lib/setup/queries";

import { StepCard } from "./step-card";
import { firstError } from "./use-setup-action";

const FOCUS_NAMES: Record<WantedFocus, string> = {
  any: "Any kind of role",
  frontend: "Frontend roles first",
  fullstack: "Full-stack roles first",
  backend: "Backend roles first",
  mobile: "Mobile roles first",
};

/** "TypeScript, React, Next.js and 5 more". */
function listed(items: string[], shown = 6): string {
  if (items.length <= shown) return items.join(", ");
  return `${items.slice(0, shown).join(", ")} and ${items.length - shown} more`;
}

function Row({
  label,
  onChange,
  children,
}: {
  label: string;
  onChange: () => void;
  children: React.ReactNode;
}) {
  // On a phone the label and Change share the first line and what was
  // saved gets the full width below; from sm up, all three sit in a row.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 border-b py-3 last:border-b-0 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
      <dt className="text-[0.8125rem] font-medium text-muted-foreground max-sm:self-center">
        {label}
      </dt>
      <dd className="col-span-2 min-w-0 text-sm sm:col-span-1 sm:col-start-2 sm:row-start-1">
        {children}
      </dd>
      <dd className="col-start-2 row-start-1 sm:col-start-3">
        <Button type="button" variant="ghost" size="sm" onClick={onChange}>
          Change<span className="sr-only"> {label.toLowerCase()}</span>
        </Button>
      </dd>
    </div>
  );
}

/**
 * Step 5: what setup saved, the daily search on or off, then the first
 * search or straight into the app. Either button finishes setup.
 */
export function ReadyStep({
  state,
  onOpenStep,
}: {
  state: SetupState;
  onOpenStep: (step: SetupStep) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const switchId = useId();
  const [dailyRun, setDailyRun] = useState(state.ready.dailyRunEnabled);
  // The time zone saved before, else this computer's, unless one is picked.
  const browserZone = useBrowserTimeZone();
  const [pickedZone, setPickedZone] = useState<string | null>(null);
  const timeZone = pickedZone ?? state.ready.timeZone ?? browserZone ?? "UTC";
  const [pending, startTransition] = useTransition();
  const [starting, setStarting] = useState<"search" | "open" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const { provider, cv, wanted } = state;
  const { answers } = wanted;

  function finish(searchNow: boolean) {
    setError(null);
    setStarting(searchNow ? "search" : "open");
    startTransition(async () => {
      const result = await callAction(() =>
        finishSetupAction({ dailyRunEnabled: dailyRun, searchNow, timeZone }),
      );
      if (!result.ok) {
        setError(firstError(result.errors));
        await queryClient.invalidateQueries({ queryKey: setupKey });
        return;
      }
      if (typeof result.search === "object") {
        // Setup is finished; the search alone couldn't start. Say why here.
        setBlocked(result.search.blocked);
        return;
      }
      router.replace("/");
    });
  }

  if (blocked) {
    return (
      <StepCard
        title="You're set up"
        description="The app is ready. Only the first search couldn't start yet."
        footer={
          <>
            <span />
            <Button type="button" onClick={() => router.replace("/")}>
              Open the app
            </Button>
          </>
        }
      >
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>The first search didn&apos;t start</AlertTitle>
          <AlertDescription>
            {blocked} You can start one from Runs once that&apos;s sorted.
          </AlertDescription>
        </Alert>
      </StepCard>
    );
  }

  const cvFrom =
    cv.path === "upload" && cv.upload?.originalName
      ? `from ${cv.upload.originalName}`
      : cv.path === "form"
        ? "from the form"
        : null;
  const levels =
    answers.seniority.length > 0
      ? answers.seniority.map((level) => SENIORITY_LABELS[level]).join(", ")
      : "Any level";
  return (
    <StepCard
      title="Ready to go"
      description="Here's what setup saved. Everything here can change later in Settings and on your Profile."
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => finish(false)}
          >
            {pending && starting === "open" ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : null}
            Open the app
          </Button>
          <Button type="button" disabled={pending} onClick={() => finish(true)}>
            {pending && starting === "search" ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : (
              <SearchIcon aria-hidden data-icon="inline-start" />
            )}
            Start my first search
          </Button>
        </>
      }
    >
      <dl className="flex flex-col rounded-lg border px-3.5">
        <Row label="AI provider" onChange={() => onOpenStep("provider")}>
          <span className="flex items-center gap-1.5">
            <CircleCheckIcon
              aria-hidden
              className="size-4 shrink-0 text-success-ink"
            />
            {ENGINE_NAMES[provider.engine]} works
          </span>
        </Row>
        <Row label="Your CV" onChange={() => onOpenStep("cv")}>
          {cv.profile ? (
            <>
              {count(cv.profile.experience.length, "role")},{" "}
              {count(cv.profile.skills.length, "skill")} and{" "}
              {count(cv.profile.education.length, "school")}
              {cvFrom ? ` ${cvFrom}` : null}
              {cv.atsCv?.status === "ready" ? (
                <span className="block text-[0.8125rem] text-muted-foreground">
                  ATS-friendly CV ready, on the CVs page
                </span>
              ) : null}
            </>
          ) : (
            "No profile yet"
          )}
        </Row>
        <Row label="Looking for" onChange={() => onOpenStep("wanted")}>
          <span className="block">
            {FOCUS_NAMES[answers.roleFocus]} · {levels}
          </span>
          <span className="block text-[0.8125rem] text-muted-foreground">
            From {listed(answers.countries, 4)} · {listed(answers.timeZones, 3)}
          </span>
          <span className="block text-[0.8125rem] text-muted-foreground">
            {listed(answers.stack)}
          </span>
        </Row>
      </dl>

      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3.5">
        <Switch
          id={switchId}
          checked={dailyRun}
          onCheckedChange={(checked) => setDailyRun(checked)}
          aria-describedby={`${switchId}-description`}
          className="mt-0.5"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <FieldLabel htmlFor={switchId} className="leading-snug">
            Search every morning at {state.ready.dailyRunTime},{" "}
            {timeZone.replaceAll("_", " ")} time
          </FieldLabel>
          <p
            id={`${switchId}-description`}
            className="text-[0.8125rem] text-muted-foreground"
          >
            {dailyRun
              ? "Each search finds new roles, scores them, and writes kits for the strongest. You click Submit on each application."
              : "Off. A search runs only when you start one on Runs."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <FieldLabel
              htmlFor={`${switchId}-time-zone`}
              className="text-[0.8125rem] font-normal text-muted-foreground"
            >
              Time zone
            </FieldLabel>
            <TimeZoneSelect
              id={`${switchId}-time-zone`}
              size="sm"
              value={timeZone}
              onChange={setPickedZone}
              disabled={pending}
              className="max-w-full"
            />
          </div>
        </div>
      </div>

      <p className="text-[0.8125rem] text-muted-foreground">
        {count(answers.stack.length, "technology", "technologies")} to search
        for. Salary floor and companies to skip are optional: add them on
        Profile, Preferences, any time.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </StepCard>
  );
}
