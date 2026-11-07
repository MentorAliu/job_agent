"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { buildCvAction } from "@/app/(app)/cvs/actions";
import {
  applyServerErrors,
  errorList,
  TagsField,
  TextField,
} from "@/components/form-fields";
import { FormSection } from "@/components/profile/form-parts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { callAction } from "@/lib/call-action";
import {
  CV_LENGTHS,
  CV_SECTIONS,
  cvBuildFormSchema,
  type CvBuildForm,
} from "@/lib/schemas/cv-builder";

import { DesignPicker } from "./design-picker";
import { LENGTH_LABELS, SECTION_LABELS } from "./labels";

// The CV builder's form. It opens filled in from the profile, so building a
// CV can be one click; every field is there to change what the CV aims at.

export function BuildCvForm({
  defaultValues,
  skills,
}: {
  defaultValues: CvBuildForm;
  /** The profile's skills, to pick from. */
  skills: string[];
}) {
  const router = useRouter();
  const form = useForm<CvBuildForm>({
    resolver: zodResolver(cvBuildFormSchema),
    defaultValues,
  });
  const { control, formState } = form;
  // Set once the CV is saved: the button stays busy until its page opens.
  const [opening, setOpening] = useState(false);

  const submit = form.handleSubmit(async (values) => {
    const result = await callAction(() => buildCvAction(values));
    if (!result.ok) {
      applyServerErrors(form.setError, result.errors);
      return;
    }
    setOpening(true);
    router.push(`/cvs/${result.id}`);
  });

  const serverError = formState.errors.root?.server?.message;
  const hasFieldErrors = Object.keys(formState.errors).some(
    (key) => key !== "root",
  );
  const busy = formState.isSubmitting || opening;

  return (
    <form
      onSubmit={(event) => {
        form.clearErrors();
        return submit(event);
      }}
      noValidate
      className="flex min-w-0 flex-col gap-4"
    >
      <FormSection
        title="The role"
        description="What the CV aims at. Claude picks what to stress from it."
      >
        <FieldGroup>
          <TextField
            control={control}
            name="targetTitle"
            label="Job title"
            description="Shown under your name."
            placeholder="Senior Frontend Engineer"
          />
          <TextField
            control={control}
            name="jobText"
            label="Job posting to match (optional)"
            description="Paste a posting and the CV uses its keywords wherever your profile backs them. Its page then shows which keywords it covers."
            multiline
            rows={6}
            placeholder="Paste the posting's text here"
            inputClassName="max-h-80"
          />
        </FieldGroup>
      </FormSection>

      <FormSection title="What to show">
        <FieldGroup>
          <TagsField
            control={control}
            name="skills"
            label="Skills to lead with"
            description="They come first under Skills. Type a skill your profile doesn't list yet, and it's added to your profile too."
            placeholder="Type a skill and press Enter"
            suggestions={() => skills}
          />
          <Controller
            control={control}
            name="length"
            render={({ field, fieldState }) => (
              <FieldSet data-invalid={fieldState.invalid || undefined}>
                <FieldLegend variant="label">Length</FieldLegend>
                <RadioGroup
                  name={field.name}
                  value={field.value}
                  onValueChange={(value) => field.onChange(value)}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {CV_LENGTHS.map((length) => (
                    <FieldLabel key={length} htmlFor={`length-${length}`}>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldTitle>{LENGTH_LABELS[length].title}</FieldTitle>
                          <FieldDescription>
                            {LENGTH_LABELS[length].description}
                          </FieldDescription>
                        </FieldContent>
                        <RadioGroupItem
                          value={length}
                          id={`length-${length}`}
                        />
                      </Field>
                    </FieldLabel>
                  ))}
                </RadioGroup>
                {fieldState.invalid && (
                  <FieldError errors={errorList(fieldState.error)} />
                )}
              </FieldSet>
            )}
          />
          <Controller
            control={control}
            name="sections"
            render={({ field, fieldState }) => (
              <FieldSet data-invalid={fieldState.invalid || undefined}>
                <FieldLegend variant="label">Sections</FieldLegend>
                <FieldDescription>
                  Summary, skills and experience are always on.
                </FieldDescription>
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                  {CV_SECTIONS.map((section) => (
                    <Field
                      key={section}
                      orientation="horizontal"
                      className="w-auto"
                    >
                      <Checkbox
                        id={`section-${section}`}
                        checked={field.value.includes(section)}
                        onCheckedChange={(checked) =>
                          field.onChange(
                            checked
                              ? CV_SECTIONS.filter(
                                  (s) =>
                                    s === section || field.value.includes(s),
                                )
                              : field.value.filter((s) => s !== section),
                          )
                        }
                      />
                      <FieldLabel
                        htmlFor={`section-${section}`}
                        className="font-normal"
                      >
                        {SECTION_LABELS[section]}
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
        </FieldGroup>
      </FormSection>

      <FormSection
        title="Design"
        description="Every design is one column of real text with standard headings, so applicant tracking systems read them all the same way. You can download the CV as a PDF or a Word file, and switch its design later for free."
      >
        <Controller
          control={control}
          name="template"
          render={({ field, fieldState }) => (
            <FieldSet data-invalid={fieldState.invalid || undefined}>
              <FieldLegend className="sr-only">Design</FieldLegend>
              <DesignPicker
                id="design"
                name={field.name}
                value={field.value}
                onChange={field.onChange}
                invalid={fieldState.invalid}
              />
              {fieldState.invalid && (
                <FieldError errors={errorList(fieldState.error)} />
              )}
            </FieldSet>
          )}
        />
      </FormSection>

      <FormSection title="Anything else (optional)">
        <TextField
          control={control}
          name="note"
          label="A note for Claude"
          hideLabel
          multiline
          rows={2}
          placeholder="For example: stress mentoring and leading projects"
          description="Claude follows it, but still writes only what your profile says."
        />
      </FormSection>

      <div className="sticky bottom-(--tab-bar-height) z-10 -mx-4 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:bottom-0">
        <p role="status" aria-live="polite" className="text-sm">
          {serverError ? (
            <span className="text-destructive">{serverError}</span>
          ) : formState.submitCount > 0 && hasFieldErrors ? (
            <span className="text-destructive">
              Some fields need fixing. They&apos;re marked in red.
            </span>
          ) : (
            <span className="text-muted-foreground">
              Claude writes it in about a minute, for a few cents.
            </span>
          )}
        </p>
        <Button type="submit" disabled={busy}>
          {busy ? (
            <Spinner aria-hidden data-icon="inline-start" />
          ) : (
            <SparklesIcon aria-hidden data-icon="inline-start" />
          )}
          Build CV
        </Button>
      </div>
    </form>
  );
}
