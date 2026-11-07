import type { InngestFunction } from "inngest";

import { addRole } from "./add-role";
import { buildCv } from "./build-cv";
import { checkEngineFunction } from "./check-engine";
import { checkListings } from "./check-listings";
import { morningClock } from "./clock";
import { dailySearch } from "./daily-search";
import { parseCv } from "./parse-cv";
import { searchAfterProfileChange } from "./profile-changed";
import { markNoResponse, readPastedEmail } from "./read-email";
import { searchRun } from "./search-run";
import { tailorJob } from "./tailor-job";

// Every background function, registered with /api/inngest.
export const functions: InngestFunction.Any[] = [
  parseCv,
  searchRun,
  dailySearch,
  tailorJob,
  readPastedEmail,
  markNoResponse,
  buildCv,
  checkListings,
  checkEngineFunction,
  addRole,
  searchAfterProfileChange,
  morningClock,
];
