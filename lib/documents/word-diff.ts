/** A run of words that both texts share, or that only one of them has. */
export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

const MAX_WORDS = 400;

/**
 * A word-level diff from `before` to `after`, from their longest common
 * subsequence of words. Whitespace is normalized. Long texts fall back to
 * one removed and one added part.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  if (a.length > MAX_WORDS || b.length > MAX_WORDS) {
    return merge([
      ...(a.length > 0
        ? [{ kind: "removed" as const, text: a.join(" ") }]
        : []),
      ...(b.length > 0 ? [{ kind: "added" as const, text: b.join(" ") }] : []),
    ]);
  }

  // lengths[i][j]: the common subsequence of a[i..] and b[j..].
  const lengths = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] =
        a[i] === b[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      parts.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (
      i < a.length &&
      (j === b.length || lengths[i + 1][j] >= lengths[i][j + 1])
    ) {
      // On a tie, removed words come before the words that replace them.
      parts.push({ kind: "removed", text: a[i] });
      i++;
    } else {
      parts.push({ kind: "added", text: b[j] });
      j++;
    }
  }
  return merge(parts);
}

/** Joins neighbouring parts of the same kind into one. */
function merge(parts: DiffPart[]): DiffPart[] {
  const merged: DiffPart[] = [];
  for (const part of parts) {
    const last = merged.at(-1);
    if (last && last.kind === part.kind) last.text += ` ${part.text}`;
    else merged.push({ ...part });
  }
  return merged;
}
