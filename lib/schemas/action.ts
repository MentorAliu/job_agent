import { z } from "zod";

/**
 * Validation errors a Server Action sends back to its form. `fieldErrors` is
 * keyed by the field's full dotted path, such as `experience.0.title`, which
 * is the name React Hook Form uses for that field.
 */
export type FieldErrors = {
  formErrors: string[];
  fieldErrors: Record<string, string[]>;
};

export type ActionFailure = { ok: false; errors: FieldErrors };

/** What a Server Action returns: success, with `T` when it has data, or errors. */
export type ActionResult<T extends object = object> =
  ({ ok: true } & T) | ActionFailure;

/**
 * `z.flattenError` groups issues by their first path segment only, so the
 * path is joined into one segment first to keep nested fields apart.
 */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const joined = new z.ZodError(
    error.issues.map((issue) => ({
      ...issue,
      path: issue.path.length > 0 ? [issue.path.map(String).join(".")] : [],
    })),
  );
  const { formErrors, fieldErrors } = z.flattenError(joined);
  return {
    formErrors,
    fieldErrors: Object.fromEntries(
      Object.entries(fieldErrors).filter(
        (entry): entry is [string, string[]] => entry[1] !== undefined,
      ),
    ),
  };
}

export function formError(message: string): ActionFailure {
  return { ok: false, errors: { formErrors: [message], fieldErrors: {} } };
}
