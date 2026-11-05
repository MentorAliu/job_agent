"use client";

import { useState } from "react";
import {
  Controller,
  type Control,
  type FieldError as RhfFieldError,
  type FieldPath,
  type FieldPathByValue,
  type FieldValues,
  type UseFormReturn,
  type UseFormSetError,
} from "react-hook-form";

import { TagInput } from "@/components/tag-input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { callAction } from "@/lib/call-action";
import type { ActionResult, FieldErrors } from "@/lib/schemas/action";

// Form fields wired to React Hook Form, following shadcn's React Hook Form
// guide: a Controller around Field, FieldLabel and FieldError.

type BaseProps<T extends FieldValues, V> = {
  control: Control<T>;
  name: FieldPathByValue<T, V>;
  label: string;
  description?: React.ReactNode;
  className?: string;
};

/**
 * The ids of a field's description and error, for `aria-describedby`, so a
 * screen reader reads why a field is invalid when it gets focus.
 */
function describedBy(
  name: string,
  hasDescription: boolean,
  invalid: boolean,
): { descriptionId?: string; errorId?: string; ids?: string } {
  const descriptionId = hasDescription ? `${name}-description` : undefined;
  const errorId = invalid ? `${name}-error` : undefined;
  const ids = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  return { descriptionId, errorId, ids };
}

/**
 * Every message in a field's error, including the per-item errors of an
 * array field such as `timeZones.1`.
 */
export function errorList(error: unknown): { message?: string }[] {
  if (!error || typeof error !== "object") return [];
  const own = error as RhfFieldError & { root?: RhfFieldError };
  const items = Array.isArray(error) ? error.flatMap(errorList) : [];
  return [own.message ? own : undefined, own.root, ...items].filter(
    (item): item is RhfFieldError => Boolean(item?.message),
  );
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  multiline,
  hideLabel,
  inputClassName,
  ...inputProps
}: BaseProps<T, string> & {
  multiline?: boolean;
  /** Keeps the label for screen readers only, for compact rows. */
  hideLabel?: boolean;
  /** Styles the input or text area itself, such as a smaller height. */
  inputClassName?: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  rows?: number;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const ids = describedBy(
          field.name,
          Boolean(description),
          fieldState.invalid,
        );
        const shared = {
          ...field,
          id: field.name,
          // A visually hidden <label> takes the width of its text in a Field,
          // which can push a phone page sideways, so name the input directly.
          "aria-label": hideLabel ? label : undefined,
          "aria-invalid": fieldState.invalid || undefined,
          "aria-describedby": ids.ids,
          className: inputClassName,
        };
        return (
          <Field
            data-invalid={fieldState.invalid || undefined}
            className={className}
          >
            {hideLabel ? null : (
              <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
            )}
            {multiline ? (
              <Textarea
                {...shared}
                rows={inputProps.rows}
                placeholder={inputProps.placeholder}
              />
            ) : (
              <Input {...shared} {...inputProps} />
            )}
            {description && (
              <FieldDescription id={ids.descriptionId}>
                {description}
              </FieldDescription>
            )}
            {fieldState.invalid && (
              <FieldError
                id={ids.errorId}
                errors={errorList(fieldState.error)}
              />
            )}
          </Field>
        );
      }}
    />
  );
}

export function TagsField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  placeholder,
  suggestions,
  tagClassName,
}: BaseProps<T, string[]> & {
  placeholder?: string;
  suggestions?: () => string[];
  /** Styles each entry, such as a monospace font for domains. */
  tagClassName?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const ids = describedBy(
          field.name,
          Boolean(description),
          fieldState.invalid,
        );
        return (
          <Field
            data-invalid={fieldState.invalid || undefined}
            className={className}
          >
            <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
            <TagInput
              id={field.name}
              ref={field.ref}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              placeholder={placeholder}
              suggestions={suggestions}
              tagClassName={tagClassName}
              invalid={fieldState.invalid}
              aria-describedby={ids.ids}
            />
            {description && (
              <FieldDescription id={ids.descriptionId}>
                {description}
              </FieldDescription>
            )}
            {fieldState.invalid && (
              <FieldError
                id={ids.errorId}
                errors={errorList(fieldState.error)}
              />
            )}
          </Field>
        );
      }}
    />
  );
}

/** A number input. An empty input is NaN, which the schema reports. */
export function NumberField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  min,
  step,
  prefix,
}: BaseProps<T, number> & {
  min?: number;
  step?: number;
  /** Shown inside the box before the number, such as "$". */
  prefix?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const ids = describedBy(
          field.name,
          Boolean(description),
          fieldState.invalid,
        );
        const input = {
          id: field.name,
          ref: field.ref,
          name: field.name,
          type: "number",
          inputMode: "decimal",
          min,
          step,
          value: Number.isNaN(field.value) ? "" : field.value,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
            field.onChange(event.target.valueAsNumber),
          onBlur: field.onBlur,
          "aria-invalid": fieldState.invalid || undefined,
          "aria-describedby": ids.ids,
        } satisfies React.ComponentProps<"input">;
        return (
          <Field
            data-invalid={fieldState.invalid || undefined}
            className={className}
          >
            <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
            {prefix ? (
              <InputGroup>
                <InputGroupInput {...input} />
                <InputGroupAddon>
                  <InputGroupText>{prefix}</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            ) : (
              <Input {...input} />
            )}
            {description && (
              <FieldDescription id={ids.descriptionId}>
                {description}
              </FieldDescription>
            )}
            {fieldState.invalid && (
              <FieldError
                id={ids.errorId}
                errors={errorList(fieldState.error)}
              />
            )}
          </Field>
        );
      }}
    />
  );
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  options,
}: BaseProps<T, string> & {
  options: { value: string; label: string }[];
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const ids = describedBy(
          field.name,
          Boolean(description),
          fieldState.invalid,
        );
        return (
          <Field
            data-invalid={fieldState.invalid || undefined}
            className={className}
          >
            <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
            <NativeSelect
              id={field.name}
              ref={field.ref}
              name={field.name}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              onBlur={field.onBlur}
              aria-invalid={fieldState.invalid || undefined}
              aria-describedby={ids.ids}
              className="w-full"
            >
              {options.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {description && (
              <FieldDescription id={ids.descriptionId}>
                {description}
              </FieldDescription>
            )}
            {fieldState.invalid && (
              <FieldError
                id={ids.errorId}
                errors={errorList(fieldState.error)}
              />
            )}
          </Field>
        );
      }}
    />
  );
}

export function CheckboxField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
}: BaseProps<T, boolean>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field
          orientation="horizontal"
          data-invalid={fieldState.invalid || undefined}
          className={className}
        >
          <Checkbox
            id={field.name}
            name={field.name}
            inputRef={field.ref}
            checked={field.value}
            onCheckedChange={(checked) => field.onChange(checked)}
            onBlur={field.onBlur}
            aria-invalid={fieldState.invalid || undefined}
          />
          <FieldLabel htmlFor={field.name} className="font-normal">
            {label}
          </FieldLabel>
          {description && <FieldDescription>{description}</FieldDescription>}
        </Field>
      )}
    />
  );
}

/** Shows a Server Action's validation errors on the form's fields. */
export function applyServerErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  errors: FieldErrors,
) {
  for (const [path, messages] of Object.entries(errors.fieldErrors)) {
    setError(path as FieldPath<T>, { type: "server", message: messages[0] });
  }
  if (errors.formErrors.length > 0) {
    setError("root.server", {
      type: "server",
      message: errors.formErrors.join(" "),
    });
  }
}

/**
 * Submits a form to its Server Action once `zodResolver` has checked it in the
 * browser. The action checks it again with the same schema, and any field
 * errors it returns show on the fields. Errors from the last attempt are
 * cleared first, so a server-only error can't block the next one.
 */
export function useServerSubmit<T extends FieldValues>(
  form: UseFormReturn<T>,
  action: (values: T) => Promise<ActionResult>,
) {
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const submit = form.handleSubmit(async (values) => {
    const result = await callAction(() => action(values));
    if (!result.ok) {
      applyServerErrors(form.setError, result.errors);
      return;
    }
    form.reset(values);
    setSavedAt(new Date());
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    form.clearErrors();
    return submit(event);
  }

  return { onSubmit, savedAt };
}
