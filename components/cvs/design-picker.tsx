"use client";

import Image from "next/image";

import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CV_TEMPLATES, type CvTemplate } from "@/lib/schemas/cv-template";
import { cn } from "@/lib/utils";

import { TEMPLATE_LABELS } from "./labels";

// The CV designs as cards to pick from, each with a picture of the same
// sample CV drawn in it (public/cv-designs, made by lib/documents/pdf.test).

/** A4's height over its width. */
const PAGE_RATIO = 297 / 210;

export function DesignPicker({
  id,
  name,
  value,
  onChange,
  invalid,
  disabled,
  compact = false,
  describedBy,
}: {
  /** Prefix for each card's input id. */
  id: string;
  name: string;
  value: CvTemplate;
  onChange: (template: CvTemplate) => void;
  invalid?: boolean;
  disabled?: boolean;
  /** Two narrow columns and no descriptions, for a sidebar. */
  compact?: boolean;
  describedBy?: string;
}) {
  return (
    <RadioGroup
      name={name}
      value={value}
      onValueChange={(next) => onChange(next as CvTemplate)}
      disabled={disabled}
      aria-describedby={describedBy}
      className={cn(
        "grid-cols-2 gap-2.5",
        compact ? null : "sm:grid-cols-4",
      )}
    >
      {CV_TEMPLATES.map((template) => {
        const label = TEMPLATE_LABELS[template];
        const inputId = `${id}-${template}`;
        return (
          <FieldLabel key={template} htmlFor={inputId} className="min-w-0">
            <Field className="gap-2">
              <div
                className="overflow-hidden rounded-md border bg-white shadow-xs"
                style={{ aspectRatio: compact ? "1 / 1" : "4 / 4.6" }}
              >
                <Image
                  src={`/cv-designs/${template}.png`}
                  alt=""
                  width={480}
                  height={Math.round(480 * PAGE_RATIO)}
                  sizes={compact ? "8rem" : "(min-width: 640px) 12rem, 45vw"}
                  className="h-auto w-full"
                />
              </div>
              <div className="flex items-start justify-between gap-2">
                <FieldContent className="min-w-0">
                  <FieldTitle>{label.title}</FieldTitle>
                  {compact ? null : (
                    <FieldDescription className="text-xs">
                      {label.description}
                    </FieldDescription>
                  )}
                </FieldContent>
                <RadioGroupItem
                  value={template}
                  id={inputId}
                  aria-invalid={invalid || undefined}
                  className="mt-0.5"
                />
              </div>
            </Field>
          </FieldLabel>
        );
      })}
    </RadioGroup>
  );
}
