import { compose } from "./stack";

/** Removes the smoke stack and its volumes, unless SMOKE_KEEP=1. */
export default async function globalTeardown(): Promise<void> {
  if (process.env.SMOKE_KEEP === "1") {
    console.log("SMOKE_KEEP=1: the smoke stack is still running.");
    return;
  }
  compose("down", "--volumes", "--remove-orphans");
}
