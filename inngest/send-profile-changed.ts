import { inngest } from "./client";
import { profileChanged, type ProfileChangeSource } from "./events";

/**
 * For the Server Actions that save the profile or the preferences: tells
 * the app scoring's input may have changed. The save has already worked, so
 * a failed send is logged, not shown; the next daily search notices the
 * change by itself.
 */
export async function sendProfileChanged(
  source: ProfileChangeSource,
): Promise<void> {
  try {
    await inngest.send(profileChanged.create({ source }));
  } catch (error) {
    console.error("Couldn't send the profile change event", error);
  }
}
