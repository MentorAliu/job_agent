import { getProfileName } from "@/lib/dal/profile";
import { requireUser } from "@/lib/dal/session";

import { AccountMenu } from "./account";

/** The signed-in owner, by the first name on their profile once there is one. */
export async function AccountRow() {
  const user = await requireUser();
  const profileName = await getProfileName();
  const name = profileName?.split(/\s+/)[0] || user.name || user.email;
  return <AccountMenu name={name} email={user.email} />;
}
