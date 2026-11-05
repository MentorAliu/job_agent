"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";

import { savePreferencesAction } from "@/app/(app)/profile/actions";
import {
  CheckboxField,
  errorList,
  SelectField,
  TagsField,
  TextField,
  useServerSubmit,
} from "@/components/form-fields";
import { SaveBar } from "@/components/profile/save-bar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  preferencesSchema,
  SALARY_PERIODS,
  SENIORITY_LEVELS,
  WANTED_FOCUS,
  type Preferences,
  type WantedFocus,
} from "@/lib/schemas/profile";

import { FormSection } from "./form-parts";

const SENIORITY_LABELS: Record<(typeof SENIORITY_LEVELS)[number], string> = {
  junior: "Junior",
  mid: "Mid-level",
  senior: "Senior",
  lead: "Lead",
  principal: "Principal or staff",
};

const FOCUS_LABELS: Record<WantedFocus, string> = {
  any: "Any kind",
  frontend: "Frontend",
  fullstack: "Full-stack",
  backend: "Backend",
  mobile: "Mobile",
};

const FOCUS_OPTIONS = WANTED_FOCUS.map((value) => ({
  value,
  label: FOCUS_LABELS[value],
}));

const PERIOD_LABELS: Record<(typeof SALARY_PERIODS)[number], string> = {
  year: "per year",
  month: "per month",
  hour: "per hour",
};

const timeZoneNames = () => Intl.supportedValuesOf("timeZone");

export function PreferencesForm({
  defaultValues,
}: {
  defaultValues: Preferences;
}) {
  const form = useForm<Preferences>({
    resolver: zodResolver(preferencesSchema),
    defaultValues,
  });
  const { control } = form;

  const { onSubmit, savedAt } = useServerSubmit(form, savePreferencesAction);

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FormSection
        title="Where you can work"
        description="Discovery skips roles you can't take from these places."
      >
        <FieldGroup>
          <CheckboxField
            control={control}
            name="remoteOnly"
            label="Remote roles only"
          />
          <TagsField
            control={control}
            name="countries"
            label="Countries you can work from"
            description="Where you live or can legally work, such as Portugal."
            placeholder="Type a country and press Enter"
          />
          <TagsField
            control={control}
            name="timeZones"
            label="Time zones you can work in"
            description="Time zone names, such as Europe/Lisbon for Portugal."
            placeholder="Europe/Lisbon"
            suggestions={timeZoneNames}
          />
        </FieldGroup>
      </FormSection>

      <FormSection title="The roles you want">
        <FieldGroup>
          <Controller
            control={control}
            name="seniority"
            render={({ field, fieldState }) => (
              <FieldSet data-invalid={fieldState.invalid || undefined}>
                <FieldLegend variant="label">Seniority</FieldLegend>
                <FieldDescription>
                  Leave all unticked to see every level.
                </FieldDescription>
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                  {SENIORITY_LEVELS.map((level) => (
                    <Field
                      key={level}
                      orientation="horizontal"
                      className="w-auto"
                    >
                      <Checkbox
                        id={`seniority-${level}`}
                        checked={field.value.includes(level)}
                        onCheckedChange={(checked) =>
                          field.onChange(
                            checked
                              ? SENIORITY_LEVELS.filter(
                                  (l) => l === level || field.value.includes(l),
                                )
                              : field.value.filter((l) => l !== level),
                          )
                        }
                      />
                      <FieldLabel
                        htmlFor={`seniority-${level}`}
                        className="font-normal"
                      >
                        {SENIORITY_LABELS[level]}
                      </FieldLabel>
                    </Field>
                  ))}
                </div>
                {fieldState.invalid && (
                  <FieldError errors={errorList(fieldState.error)} />
                )}
              </FieldSet>
            )}
          />
          <SelectField
            control={control}
            name="roleFocus"
            label="Roles you want most"
            description="These come first in searches, scores and kits, whatever framework they use."
            options={FOCUS_OPTIONS}
          />
          <TagsField
            control={control}
            name="stack"
            label="Stack"
            description="The technologies you want to work with."
            placeholder="TypeScript, React…"
          />
          <TagsField
            control={control}
            name="excludedCompanies"
            label="Companies to skip"
            placeholder="Type a company and press Enter"
          />
        </FieldGroup>
      </FormSection>

      <FormSection
        title="Salary floor"
        description="Roles that state a lower salary are flagged. Leave the amount empty for no floor."
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem_10rem]">
          <Controller
            control={control}
            name="salaryFloor.amount"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor={field.name}>Amount</FieldLabel>
                <Input
                  id={field.name}
                  ref={field.ref}
                  name={field.name}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={field.value ?? ""}
                  onChange={(event) =>
                    field.onChange(
                      event.target.value === ""
                        ? null
                        : event.target.valueAsNumber,
                    )
                  }
                  onBlur={field.onBlur}
                  aria-invalid={fieldState.invalid || undefined}
                />
                {fieldState.invalid && (
                  <FieldError errors={errorList(fieldState.error)} />
                )}
              </Field>
            )}
          />
          <TextField
            control={control}
            name="salaryFloor.currency"
            label="Currency"
            placeholder="EUR"
          />
          <Controller
            control={control}
            name="salaryFloor.period"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Per</FieldLabel>
                <NativeSelect
                  id={field.name}
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  onBlur={field.onBlur}
                  className="w-full"
                >
                  {SALARY_PERIODS.map((period) => (
                    <NativeSelectOption key={period} value={period}>
                      {PERIOD_LABELS[period]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
          />
        </div>
      </FormSection>

      <SaveBar form={form} savedAt={savedAt} label="Save preferences" />
    </form>
  );
}
