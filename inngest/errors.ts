import { APIError, AuthenticationError } from "@anthropic-ai/sdk";
import { NonRetriableError } from "inngest";

/**
 * Whether a Claude API error would fail the same way on a retry: a rejected
 * key or an invalid request. Rate limits, timeouts and server errors aren't.
 */
export function isPermanentApiError(error: unknown): error is APIError {
  return (
    error instanceof APIError &&
    error.status !== undefined &&
    error.status >= 400 &&
    error.status < 500 &&
    ![408, 409, 429].includes(error.status)
  );
}

/** A readable message for an API error that won't go away on a retry. */
export function apiErrorMessage(error: APIError): string {
  if (error instanceof AuthenticationError) {
    return "The Claude API key was rejected. Paste a new one in Settings, under Agents run on.";
  }
  const body = error.error as { error?: { message?: string } } | undefined;
  return `The Claude API refused the request: ${body?.error?.message ?? error.message}`;
}

/**
 * Errors that would fail the same way on a retry end the function with a
 * readable message: any of `permanent`, a rejected API key, an invalid
 * request. Anything else is thrown again, so Inngest retries the step.
 */
export function permanentOrRetry(
  error: unknown,
  permanent: (new (...args: never[]) => Error)[] = [],
): unknown {
  if (permanent.some((type) => error instanceof type)) {
    return new NonRetriableError((error as Error).message, { cause: error });
  }
  if (isPermanentApiError(error)) {
    return new NonRetriableError(apiErrorMessage(error), { cause: error });
  }
  return error;
}
