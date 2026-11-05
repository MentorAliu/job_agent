"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useEffect, useRef } from "react";

import { buttonVariants } from "@/components/ui/button";
import { SETUP_STEPS, type SetupStep } from "@/lib/schemas/setup";
import { shownStep } from "@/lib/setup/progress";
import { setupStateQuery } from "@/lib/setup/queries";

import { CvStep } from "./cv-step";
import { ProviderStep } from "./provider-step";
import { ReadyStep } from "./ready-step";
import { SetupStepper } from "./setup-stepper";
import { STEP_TITLE_ID } from "./step-card";
import { WantedStep } from "./wanted-step";

const stepParser = parseAsStringLiteral(SETUP_STEPS);

/**
 * First-run setup, one step at a time. What's done comes from the server, so
 * setup picks up where it was left in any tab or device; the step shown is
 * kept in the address, so finishing one doesn't move the page on by itself.
 */
export function SetupWizard() {
  const { data: state } = useSuspenseQuery(setupStateQuery());
  const [asked, setAsked] = useQueryState("step", stepParser);
  const shown = shownStep(asked, state.completed);

  // A step that can't be shown yet, or none asked for, gives way to the
  // first one that's open, in place in the history.
  useEffect(() => {
    if (asked !== shown) void setAsked(shown, { history: "replace" });
  }, [asked, shown, setAsked]);

  // A new step takes focus at its title, for keyboards and screen readers.
  const lastShown = useRef(shown);
  useEffect(() => {
    if (lastShown.current === shown) return;
    lastShown.current = shown;
    document.getElementById(STEP_TITLE_ID)?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [shown]);

  function goTo(step: SetupStep) {
    void setAsked(step, { history: "push" });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Set up Job Agent
        </h1>
        <p className="text-sm text-muted-foreground">
          A few steps, once. The app opens when they&apos;re done, and you can
          change everything later.
        </p>
      </div>
      <SetupStepper
        shown={shown}
        completed={state.completed}
        current={state.current}
        onOpen={goTo}
      />
      {state.done && shown !== "ready" ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-success-soft/40 p-3.5 text-sm"
        >
          <span className="flex items-center gap-2 font-medium">
            <CircleCheckIcon aria-hidden className="size-4 text-success-ink" />
            Setup is finished.
          </span>
          <Link href="/" className={buttonVariants({ size: "sm" })}>
            Open the app
          </Link>
        </div>
      ) : null}
      {shown === "provider" ? (
        <ProviderStep provider={state.provider} onContinue={() => goTo("cv")} />
      ) : shown === "cv" ? (
        <CvStep cv={state.cv} onContinue={() => goTo("wanted")} />
      ) : shown === "wanted" ? (
        <WantedStep wanted={state.wanted} onContinue={() => goTo("ready")} />
      ) : (
        <ReadyStep state={state} onOpenStep={goTo} />
      )}
    </div>
  );
}
