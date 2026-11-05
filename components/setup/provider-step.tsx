"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon } from "lucide-react";
import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";

import { chooseEngineAction } from "@/app/setup/actions";
import { EngineCheckPanel } from "@/components/engines/engine-check";
import { EngineChoiceCards } from "@/components/engines/engine-choices";
import { EngineConnect } from "@/components/engines/engine-connect";
import { useCheckEngine } from "@/components/engines/use-check-engine";
import { Button } from "@/components/ui/button";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { callAction } from "@/lib/call-action";
import type { SetupState } from "@/lib/dal/setup";
import { ENGINE_NAMES, type AgentEngine } from "@/lib/schemas/settings";
import { isCheckActive, setupKey } from "@/lib/setup/queries";

import { StepCard } from "./step-card";
import { firstError } from "./use-setup-action";

/**
 * Step 2: pick what the agents run on, connect it, and check it works. The
 * check starts by itself once the provider is connected, and Continue opens
 * only after it passed.
 */
export function ProviderStep({
  provider,
  onContinue,
}: {
  provider: SetupState["provider"];
  onContinue: () => void;
}) {
  const queryClient = useQueryClient();
  const check = useCheckEngine();
  const saved = provider.chosen ? provider.engine : null;
  const [engine, showEngine] = useOptimistic(saved);
  const [choosing, startChoosing] = useTransition();
  const [chooseError, setChooseError] = useState<string | null>(null);
  const cards = useRef<HTMLDivElement>(null);
  // The engine a check last started on by itself, so it starts once.
  const autoChecked = useRef<AgentEngine | null>(null);

  const view = engine ? provider.engines[engine] : null;
  const last =
    engine && provider.check?.engine === engine ? provider.check : null;
  const stale = Boolean(
    last?.status === "passed" &&
    view?.loginSavedAt &&
    Date.parse(view.loginSavedAt) > Date.parse(last.createdAt),
  );
  const settled = !choosing && engine !== null && engine === saved;
  const passed = settled && provider.passed;

  // Once the picked provider is connected, check it without being asked:
  // when it was never checked, its sign-in changed, or it wasn't connected
  // at the last check.
  const signedIn = view?.signedIn ?? false;
  useEffect(() => {
    if (!settled || !engine || !signedIn) return;
    if (isCheckActive(last) || autoChecked.current === engine) return;
    const due =
      !last || stale || (last.status === "failed" && last.failure === "setup");
    if (!due) return;
    autoChecked.current = engine;
    check.start(engine);
  }, [settled, engine, signedIn, last, stale, check]);

  function choose(next: AgentEngine) {
    if (next === engine) return;
    setChooseError(null);
    check.clearError();
    startChoosing(async () => {
      showEngine(next);
      const result = await callAction(() =>
        chooseEngineAction({ engine: next }),
      );
      if (!result.ok) setChooseError(firstError(result.errors));
      await queryClient.invalidateQueries({ queryKey: setupKey });
    });
  }

  function checkNow(target: AgentEngine) {
    autoChecked.current = target;
    check.start(target);
  }

  function pickAnother() {
    const group = cards.current;
    group?.scrollIntoView({ behavior: "smooth", block: "center" });
    group
      ?.querySelector<HTMLElement>('[role="radio"]:not([aria-checked="true"])')
      ?.focus();
  }

  const name = engine ? ENGINE_NAMES[engine] : null;
  return (
    <StepCard
      title="Choose what the agents run on"
      description="Every step that needs an AI model runs on it: searching, reading postings, scoring, kits, CVs and emails. A plan's command-line agent costs nothing per call. You can switch later in Settings."
      footer={
        <>
          <p className="text-[0.8125rem] text-muted-foreground">
            {passed ? null : "Continue opens once the check passes."}
          </p>
          <Button type="button" disabled={!passed} onClick={onContinue}>
            Continue
            <ArrowRightIcon aria-hidden data-icon="inline-end" />
          </Button>
        </>
      }
    >
      <FieldSet>
        <FieldLegend className="sr-only">Agents run on</FieldLegend>
        <div ref={cards}>
          <EngineChoiceCards
            name="setup-engine"
            value={engine}
            onValueChange={choose}
            engines={provider.engines}
          />
        </div>
      </FieldSet>
      {chooseError ? (
        <p role="alert" className="text-sm text-destructive">
          {chooseError}
        </p>
      ) : null}

      {engine && view ? (
        <div className="flex flex-col gap-3 border-t pt-4">
          <h3 className="text-sm font-semibold">Connect {name}</h3>
          <EngineConnect
            engine={engine}
            engines={provider.engines}
            runner={provider.runner}
            fallback={null}
            history={false}
            onChange={(savedNow) => {
              void queryClient.invalidateQueries({ queryKey: setupKey });
              if (savedNow) checkNow(engine);
            }}
          />
          <EngineCheckPanel
            engine={engine}
            check={last}
            ready={view.signedIn && settled}
            runner={provider.runner}
            pending={check.pending}
            error={check.error}
            stale={stale}
            onCheck={() => checkNow(engine)}
            onPickAnother={pickAnother}
          />
        </div>
      ) : (
        <p className="text-[0.8125rem] text-muted-foreground">
          Pick one to see how to connect it.
        </p>
      )}
    </StepCard>
  );
}
