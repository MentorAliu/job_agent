export type Storage = {
  /** Writes the bytes under `key`, replacing anything already there. */
  put(key: string, data: Uint8Array): Promise<void>;
  /** Reads the bytes under `key`, or returns null when there is no such file. */
  get(key: string): Promise<Uint8Array | null>;
  /** Removes the file under `key`. Removing a missing file is not an error. */
  delete(key: string): Promise<void>;
};

/**
 * Keys are relative paths such as `cv/3f2a….pdf`: letters, digits, `-`, `_`
 * and `.`, separated by `/`. No empty, `.` or `..` segments.
 */
export function assertValidKey(key: string): void {
  const segments = key.split("/");
  const valid =
    key.length > 0 &&
    key.length <= 512 &&
    segments.every(
      (segment) =>
        /^[A-Za-z0-9._-]+$/.test(segment) &&
        segment !== "." &&
        segment !== "..",
    );
  if (!valid) throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
}
