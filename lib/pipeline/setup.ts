import "server-only";

import { eq, sql } from "drizzle-orm";

import { setup } from "@/db/schema";
import { db, type Db } from "@/lib/dal/db";
import { timeZoneName, timeZoneOrUtc } from "@/lib/jobs/today";

// First-run setup's progress: one row, for lib/dal (which checks the
// session first) and for Inngest steps, which run with no signed-in user.

const SETUP_ID = 1;

export type SetupRow = typeof setup.$inferSelect;

/** The setup row, or null before setup has saved anything. */
export async function readSetupRow(): Promise<SetupRow | null> {
  const [row] = await db.select().from(setup).where(eq(setup.id, SETUP_ID));
  return row ?? null;
}

/**
 * Whether this copy has finished first-run setup. Until then the app's pages
 * open setup, and the daily search doesn't run.
 */
export async function isSetupDone(): Promise<boolean> {
  const [row] = await db
    .select({ doneAt: setup.doneAt })
    .from(setup)
    .where(eq(setup.id, SETUP_ID));
  return Boolean(row?.doneAt);
}

/**
 * The owner's time zone, which decides when the morning runs start and when
 * the owner's day turns over. UTC until setup saves one. `from` is a
 * transaction to read it in, if any.
 */
export async function readOwnerTimeZone(
  from: Pick<Db, "select"> = db,
): Promise<string> {
  const [row] = await from
    .select({ timeZone: setup.timeZone })
    .from(setup)
    .where(eq(setup.id, SETUP_ID));
  return timeZoneOrUtc(row?.timeZone);
}

/** For the morning clock, in one read: is setup done, and the time zone. */
export async function readClockSetup(): Promise<{
  done: boolean;
  timeZone: string;
}> {
  const [row] = await db
    .select({ doneAt: setup.doneAt, timeZone: setup.timeZone })
    .from(setup)
    .where(eq(setup.id, SETUP_ID));
  return {
    done: Boolean(row?.doneAt),
    timeZone: timeZoneOrUtc(row?.timeZone),
  };
}

/**
 * The time zone as it will be saved, or null when it can't be: not a time
 * zone name, or one the database doesn't know. The lists and the day's
 * counts ask Postgres for days in the owner's time zone, so a name only the
 * browser knows would break them.
 */
export async function savableTimeZone(value: string): Promise<string | null> {
  const name = timeZoneName(value);
  if (!name) return null;
  try {
    await db.execute(sql`select now() at time zone ${name}`);
    return name;
  } catch {
    return null;
  }
}

/** Saves some of setup's progress, creating the row the first time. */
export async function writeSetupRow(
  values: Partial<Omit<typeof setup.$inferInsert, "id" | "updatedAt">>,
): Promise<void> {
  const changes = { ...values, updatedAt: new Date() };
  await db
    .insert(setup)
    .values({ id: SETUP_ID, ...changes })
    .onConflictDoUpdate({ target: setup.id, set: changes });
}
