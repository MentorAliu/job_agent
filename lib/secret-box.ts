import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

// Encrypts the few secrets the app keeps in its database, such as Codex's
// sign-in file, with a key derived from BETTER_AUTH_SECRET. A copy of the
// database alone can't read them.

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(purpose: string, secret = process.env.BETTER_AUTH_SECRET): Buffer {
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET isn't set, so the app can't keep secrets in its database.",
    );
  }
  return Buffer.from(hkdfSync("sha256", secret, "job-agent", purpose, 32));
}

/** AES-256-GCM, as "v1:" and base64 of the IV, the tag and the ciphertext. */
export function seal(plaintext: string, purpose: string, secret?: string) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(purpose, secret), iv);
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const sealed = Buffer.concat([iv, cipher.getAuthTag(), body]);
  return `${VERSION}:${sealed.toString("base64")}`;
}

/** The plaintext, or null when the value was sealed with another key or changed. */
export function open(
  sealed: string,
  purpose: string,
  secret?: string,
): string | null {
  const [version, encoded] = sealed.split(":", 2);
  if (version !== VERSION || !encoded) return null;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length <= IV_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(purpose, secret),
      bytes.subarray(0, IV_BYTES),
    );
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
