import { unstable_isUnrecognizedActionError } from "next/navigation";

import {
  formError,
  type ActionFailure,
  type ActionResult,
} from "@/lib/schemas/action";

export const STALE_PAGE_MESSAGE =
  "The app was updated after this page opened. Reload the page and try again.";

export const ACTION_FAILED_MESSAGE =
  "Couldn't save. Check that the app is running, then try again.";

/**
 * Calls a Server Action from the browser. A tab opened before the app was
 * rebuilt still holds the old build's action ids, which the server rejects
 * with a 409. That failure, and any other thrown error, comes back as a form
 * error the page can show instead of an exception.
 */
export async function callAction<T extends ActionResult>(
  run: () => Promise<T>,
): Promise<T | ActionFailure> {
  try {
    return await run();
  } catch (error) {
    if (unstable_isUnrecognizedActionError(error))
      return formError(STALE_PAGE_MESSAGE);
    console.error(error);
    return formError(ACTION_FAILED_MESSAGE);
  }
}
