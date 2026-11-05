"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { Controller, useWatch, type Control } from "react-hook-form";

import { errorList } from "@/components/form-fields";
import { EngineCheckPanel } from "@/components/engines/engine-check";
import { EngineChoiceCards } from "@/components/engines/engine-choices";
import {
  EngineConnect,
  FallbackNote,
} from "@/components/engines/engine-connect";
import { useCheckEngine } from "@/components/engines/use-check-engine";
import { FieldError, FieldLegend, FieldSet } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import type { SettingsView } from "@/lib/dal/settings";
import { engineCheckQuery } from "@/lib/setup/queries";
import {
  ENGINE_NAMES,
  type AgentEngine,
  type SettingsInput,
} from "@/lib/schemas/settings";

import { SettingsCard } from "./settings-card";

/**
 * What the agent steps run on, as one card per choice: a command-line agent
 * on the owner's own plan first, then the Claude API or the OpenAI API with
 * the owner's key, with each one's sign-in, how its last steps went, and
 * Check it works for the engine Settings has saved.
 */
export function AgentsCard({
  control,
  settings,
}: {
  control: Control<SettingsInput>;
  settings: SettingsView;
}) {
  const { engines, claudeApiKey, runner } = settings;
  const picked = useWatch({ control, name: "agentEngine" });
  const saved = settings.values.agentEngine;
  const check = useCheckEngine();
  // A plan's agent falls back to whichever API the app has a key for; the
  // OpenAI API only to the Claude API.
  const fallback =
    picked === "openai_api"
      ? claudeApiKey
        ? "claude_api"
        : null
      : settings.fallback;
  return (
    <SettingsCard
      title="Agents run on"
      description="Every step that needs an AI model: searching, reading postings, scoring, kits, CVs and emails."
    >
      <Controller
        control={control}
        name="agentEngine"
        render={({ field, fieldState }) => (
          <FieldSet data-invalid={fieldState.invalid || undefined}>
            <FieldLegend className="sr-only">Agents run on</FieldLegend>
            <EngineChoiceCards
              name={field.name}
              value={field.value}
              onValueChange={field.onChange}
              engines={engines}
            />
            {fieldState.invalid && (
              <FieldError errors={errorList(fieldState.error)} />
            )}
          </FieldSet>
        )}
      />

      <div className="flex flex-col gap-3 border-t pt-4">
        <EngineConnect
          engine={picked}
          engines={engines}
          runner={runner}
          fallback={fallback}
          onChange={(signedIn) => {
            // A new sign-in or key for the saved engine: check it at once.
            if (signedIn && picked === saved) check.start(saved);
          }}
        />
        {picked === saved ? (
          <Suspense fallback={<Skeleton className="h-24 rounded-lg" />}>
            <SavedEngineCheck
              engine={saved}
              settings={settings}
              check={check}
            />
          </Suspense>
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">
            Save to switch to {ENGINE_NAMES[picked]}. The app then checks it
            works.
          </p>
        )}
        {picked === "claude_api" ? null : (
          <FallbackNote engine={picked} runner={runner} fallback={fallback} />
        )}
      </div>
    </SettingsCard>
  );
}

function SavedEngineCheck({
  engine,
  settings,
  check,
}: {
  engine: AgentEngine;
  settings: SettingsView;
  check: ReturnType<typeof useCheckEngine>;
}) {
  const { data: last } = useSuspenseQuery(engineCheckQuery(engine));
  const view = settings.engines[engine];
  const stale =
    last?.status === "passed" &&
    view.loginSavedAt !== null &&
    Date.parse(view.loginSavedAt) > Date.parse(last.createdAt);
  return (
    <EngineCheckPanel
      engine={engine}
      check={last}
      ready={view.signedIn}
      runner={settings.runner}
      pending={check.pending}
      error={check.error}
      stale={stale}
      onCheck={() => check.start(engine)}
    />
  );
}
