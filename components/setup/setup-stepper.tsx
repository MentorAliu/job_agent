"use client";

import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  SETUP_STEPS,
  SETUP_STEP_NAMES,
  type SetupStep,
} from "@/lib/schemas/setup";
import type { StepsDone } from "@/lib/setup/progress";

/**
 * Where setup is: the account (always done here), then each step. A step
 * that's done, or the first open one, can be opened again; later ones wait.
 */
export function SetupStepper({
  shown,
  completed,
  current,
  onOpen,
}: {
  shown: SetupStep;
  completed: StepsDone;
  /** The first step that isn't done. */
  current: SetupStep;
  onOpen: (step: SetupStep) => void;
}) {
  const reachable = SETUP_STEPS.slice(0, SETUP_STEPS.indexOf(current) + 1);
  const total = SETUP_STEPS.length + 1;
  return (
    <nav aria-label="Setup steps">
      <ol className="grid grid-cols-5 gap-1.5 sm:gap-3">
        <Step
          number={1}
          total={total}
          label="Account"
          done
          active={false}
          reachable={false}
        />
        {SETUP_STEPS.map((step, index) => (
          <Step
            key={step}
            number={index + 2}
            total={total}
            label={SETUP_STEP_NAMES[step]}
            done={completed[step]}
            active={step === shown}
            reachable={reachable.includes(step) && step !== shown}
            onOpen={() => onOpen(step)}
          />
        ))}
      </ol>
    </nav>
  );
}

function Step({
  number,
  total,
  label,
  done,
  active,
  reachable,
  onOpen,
}: {
  number: number;
  total: number;
  label: string;
  done: boolean;
  active: boolean;
  reachable: boolean;
  onOpen?: () => void;
}) {
  const content = (
    <>
      <span
        aria-hidden
        className={cn(
          "h-1 w-full rounded-full bg-muted",
          (done || active) && "bg-primary",
          active && !done && "bg-primary/60",
        )}
      />
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-full border text-[0.6875rem] font-semibold tabular-nums",
            done
              ? "border-primary bg-primary text-primary-foreground"
              : active
                ? "border-primary text-primary-ink"
                : "text-muted-foreground",
          )}
        >
          {done ? <CheckIcon className="size-3" /> : number}
        </span>
        <span
          className={cn(
            "truncate text-xs font-medium max-sm:sr-only",
            active ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
      </span>
      <span className="sr-only">
        {`, step ${number} of ${total}${done ? ", done" : active ? ", current" : ""}`}
      </span>
    </>
  );
  return (
    <li className="min-w-0">
      {reachable && onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full min-w-0 flex-col gap-2 rounded-md text-start outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {content}
        </button>
      ) : (
        <div
          aria-current={active ? "step" : undefined}
          className="flex min-w-0 flex-col gap-2"
        >
          {content}
        </div>
      )}
    </li>
  );
}
