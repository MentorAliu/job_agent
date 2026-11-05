import { Inngest } from "inngest";

// Locally INNGEST_DEV=1 points the SDK at the Dev Server. In Docker and on
// Inngest Cloud it uses INNGEST_BASE_URL, INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY.
export const inngest = new Inngest({ id: "job-agent" });
