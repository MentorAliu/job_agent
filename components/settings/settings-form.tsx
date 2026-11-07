"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Controller, useForm, useWatch } from "react-hook-form";

import {
  checkEngineAction,
  saveSettingsAction,
} from "@/app/(app)/settings/actions";
import {
  errorList,
  NumberField,
  useServerSubmit,
} from "@/components/form-fields";
import { SaveBar } from "@/components/profile/save-bar";
import { DesignPicker } from "@/components/cvs/design-picker";
import { BudgetMeter } from "@/components/runs/budget-meter";
import { formatBudget, formatCost } from "@/components/runs/run-labels";
import {
  TimeZoneSelect,
  useBrowserTimeZone,
} from "@/components/time-zone-select";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import type { SettingsView } from "@/lib/dal/settings";
import { DAILY_RUN_TIME } from "@/lib/jobs/today";
import { engineCheckQuery } from "@/lib/setup/queries";
import {
  settingsInputSchema,
  type SettingsInput,
} from "@/lib/schemas/settings";

import { AgentsCard } from "./agents-card";
import { AppearanceCard } from "./appearance";
import { FormFillerCard } from "./form-filler-card";
import { SettingsCard } from "./settings-card";

/**
 * What the owner decides, whether the daily search runs and in which time
 * zone, what the agents run on and how much they may spend a month, beside
 * the form filler and the theme. Where it searches, which models it uses and
 * the per-run cap are fixed in code.
 */
export function SettingsForm({
  settings,
  nextRun,
}: {
  settings: SettingsView;
  /** When the daily search runs next, such as "tomorrow at 07:00". */
  nextRun: string;
}) {
  const form = useForm<SettingsInput>({
    resolver: zodResolver(settingsInputSchema),
    defaultValues: settings.values,
  });
  const { control } = form;
  const queryClient = useQueryClient();
  const { onSubmit, savedAt } = useServerSubmit(form, async (values) => {
    const result = await saveSettingsAction(values);
    const engine = values.agentEngine;
    // Switching what the agents run on checks the new one straight away,
    // when it's signed in. The card shows how the check goes.
    if (
      result.ok &&
      engine !== settings.values.agentEngine &&
      settings.engines[engine].signedIn
    ) {
      await checkEngineAction({ engine }).catch(() => null);
      await queryClient.invalidateQueries({
        queryKey: engineCheckQuery(engine).queryKey,
      });
    }
    return result;
  });
  const [dailyRun, monthlyBudget, timeZone] = useWatch({
    control,
    name: ["dailyRunEnabled", "monthlyBudgetUsd", "timeZone"],
  });
  const limitUsd = Number.isNaN(monthlyBudget) ? 0 : monthlyBudget;
  const browserZone = useBrowserTimeZone();
  // Saved, the next search is as the server worked it out; changed, it
  // follows the new time zone from the next morning run.
  const zoneChanged = timeZone !== settings.values.timeZone;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          <SettingsCard
            title="Daily search"
            description="Each search finds new roles, scores them, and writes kits for the strongest."
          >
            <Controller
              control={control}
              name="dailyRunEnabled"
              render={({ field }) => (
                <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3.5">
                  <Switch
                    id={field.name}
                    name={field.name}
                    inputRef={field.ref}
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked)}
                    onBlur={field.onBlur}
                    aria-describedby={`${field.name}-description`}
                    className="mt-0.5"
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <FieldLabel htmlFor={field.name} className="leading-snug">
                      Search every morning at {DAILY_RUN_TIME},{" "}
                      {timeZone.replaceAll("_", " ")} time
                    </FieldLabel>
                    <p
                      id={`${field.name}-description`}
                      className="text-[0.8125rem] text-muted-foreground"
                    >
                      {!dailyRun
                        ? "Off. A search runs only when you start one on Runs."
                        : zoneChanged
                          ? `After you save, searches start at ${DAILY_RUN_TIME} in the new time zone.`
                          : `Next search ${nextRun}.`}
                    </p>
                  </div>
                </div>
              )}
            />
            <Controller
              control={control}
              name="timeZone"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor={field.name}>Your time zone</FieldLabel>
                  <TimeZoneSelect
                    id={field.name}
                    ref={field.ref}
                    name={field.name}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    aria-invalid={fieldState.invalid || undefined}
                    aria-describedby={`${field.name}-description`}
                    className="w-full max-w-xs"
                  />
                  <FieldDescription id={`${field.name}-description`}>
                    Setup took it from your computer. The morning runs start by
                    it, and your day turns over at midnight in it.
                  </FieldDescription>
                  {browserZone && browserZone !== field.value ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted-foreground">
                      This computer is on {browserZone.replaceAll("_", " ")}{" "}
                      time.
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto px-0"
                        onClick={() => field.onChange(browserZone)}
                      >
                        Use it
                      </Button>
                    </div>
                  ) : null}
                  {fieldState.invalid ? (
                    <FieldError errors={errorList(fieldState.error)} />
                  ) : null}
                </Field>
              )}
            />
          </SettingsCard>

          <SettingsCard
            title="Monthly budget"
            description="Every Claude API and OpenAI API call checks it first. Steps on Claude Code or Codex don't count. Months start on the 1st, in UTC."
          >
            <NumberField
              control={control}
              name="monthlyBudgetUsd"
              label="Most the agents may spend a month (USD)"
              description="Once this month's spend reaches it, searches and kits stop until next month."
              min={0}
              step={1}
              prefix="$"
              className="max-w-xs"
            />
            {settings.saved ? null : (
              <p className="text-[0.8125rem] text-muted-foreground">
                Until you save, this comes from MONTHLY_BUDGET_USD in the
                app&apos;s environment.
              </p>
            )}
            <div className="flex flex-col gap-2 border-t pt-4">
              <p className="flex items-baseline justify-between gap-2 text-[0.8125rem] text-muted-foreground">
                This month so far
                <span className="font-semibold text-foreground tabular-nums">
                  {formatCost(settings.monthSpendUsd)} of{" "}
                  {formatBudget(limitUsd)}
                </span>
              </p>
              <BudgetMeter
                spentUsd={settings.monthSpendUsd}
                limitUsd={limitUsd}
              />
            </div>
          </SettingsCard>

          <SettingsCard
            title="CV design"
            description="The design apply kits draw your CV and cover letter in, and the first choice when you build a CV. Each is one column an applicant tracking system reads in order."
          >
            <Controller
              control={control}
              name="cvTemplate"
              render={({ field, fieldState }) => (
                <FieldSet data-invalid={fieldState.invalid || undefined}>
                  <FieldLegend className="sr-only">CV design</FieldLegend>
                  <DesignPicker
                    id="cv-design"
                    name={field.name}
                    value={field.value}
                    onChange={field.onChange}
                    invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    Kits written from now on use it. To change one CV, open it
                    on the CVs page.
                  </FieldDescription>
                  {fieldState.invalid ? (
                    <FieldError errors={errorList(fieldState.error)} />
                  ) : null}
                </FieldSet>
              )}
            />
          </SettingsCard>
        </div>

        <div className="flex flex-col gap-4">
          <AgentsCard control={control} settings={settings} />
          <FormFillerCard />
          <AppearanceCard />
        </div>
      </div>

      <SaveBar form={form} savedAt={savedAt} label="Save settings" />
    </form>
  );
}
