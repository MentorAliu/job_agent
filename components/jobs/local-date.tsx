"use client";

import { useId } from "react";

import { InlineScript } from "@/components/inline-script";

const DAY: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};
const TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

/**
 * A timestamp in the browser's time zone, written the British way (18 Oct
 * 2026, 07:00). The server can only render its own time zone, so on a full
 * page load an inline script rewrites the text before the first paint. After
 * that, the browser renders it directly.
 */
export function LocalDate({
  iso,
  withTime = false,
  format,
  className,
}: {
  iso: string;
  withTime?: boolean;
  /** Overrides the day, or day and time, format. */
  format?: Intl.DateTimeFormatOptions;
  className?: string;
}) {
  const id = useId();
  const options = format ?? (withTime ? { ...DAY, ...TIME } : DAY);
  const text = new Intl.DateTimeFormat("en-GB", options).format(new Date(iso));
  return (
    <>
      <time
        id={id}
        dateTime={iso}
        className={className}
        suppressHydrationWarning
      >
        {text}
      </time>
      <InlineScript
        html={`{var n=document.getElementById(${JSON.stringify(id)});if(n)n.textContent=new Intl.DateTimeFormat("en-GB",${JSON.stringify(options)}).format(new Date(${JSON.stringify(iso)}))}`}
      />
    </>
  );
}
