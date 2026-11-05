"use client";

import { useEffect, useState } from "react";

/**
 * True once `ms` has passed since `since`, so a note can show after a wait,
 * such as "still waiting for the background worker". It starts false on the
 * server and in the first render, so the two agree.
 */
export function useAfter(since: string | null, ms: number): boolean {
  const due = since ? Date.parse(since) + ms : null;
  // The time it last turned due.
  const [dueSeen, setDueSeen] = useState<number | null>(null);
  useEffect(() => {
    if (due === null) return;
    const timer = setTimeout(
      () => setDueSeen(due),
      Math.max(0, due - Date.now()) + 50,
    );
    return () => clearTimeout(timer);
  }, [due]);
  return due !== null && dueSeen === due;
}
