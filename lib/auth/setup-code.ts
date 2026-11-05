// The one-time code that creates the owner's account. It comes from
// BETTER_AUTH_SECRET, so each copy of the app has its own and nothing has to
// store it: `scripts/setup.mjs` prints it when it writes the secret, and the
// sign-in page writes it to the server log while no account exists.
//
// No `server-only` or `@/` imports: the Better Auth CLI loads lib/auth/options.ts,
// which imports this file, outside Next.js.
import { createHmac, timingSafeEqual } from "node:crypto";

/** 32 letters and digits, without 0, O, 1 and I, which read alike. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LENGTH = 8;

/**
 * The setup code for a secret, such as "K7QM-4XPA". 8 characters of 5 bits
 * each, 40 bits in all. `scripts/setup.mjs` has a copy of this function, and
 * a test keeps the two the same.
 */
export function setupCodeFor(secret: string): string {
  const digest = createHmac("sha256", secret)
    .update("job-agent setup code")
    .digest();
  // 256 is a multiple of 32, so the low 5 bits of each byte are uniform.
  const code = Array.from(digest.subarray(0, LENGTH), (byte) =>
    ALPHABET.charAt(byte & 31),
  ).join("");
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Upper case, letters and digits only, so "k7qm 4xpa" matches "K7QM-4XPA". */
export function normalizeSetupCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** True when `input` is the setup code for `secret`. Fails closed. */
export function setupCodeMatches(
  input: unknown,
  secret: string | undefined,
): boolean {
  if (!secret || typeof input !== "string") return false;
  const given = Buffer.from(normalizeSetupCode(input));
  const expected = Buffer.from(normalizeSetupCode(setupCodeFor(secret)));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
