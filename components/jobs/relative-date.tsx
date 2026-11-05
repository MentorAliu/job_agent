"use client";

import { useId, useSyncExternalStore } from "react";

import { InlineScript } from "@/components/inline-script";

// Each of these runs in two places: in React, and as an inline script
// before the first paint (see RelativeDate). So each stands alone, using
// nothing from outside its own body.

/** "07:04" today, "Sat" within the past week, "12 Oct" before that. */
export function shortWhen(iso: string, now: number): string {
  const date = new Date(iso);
  const midnight = (time: Date) =>
    new Date(time.getFullYear(), time.getMonth(), time.getDate()).getTime();
  const days = Math.round((midnight(new Date(now)) - midnight(date)) / 864e5);
  const options: Intl.DateTimeFormatOptions =
    days <= 0
      ? { hour: "2-digit", minute: "2-digit" }
      : days < 7
        ? { weekday: "short" }
        : { day: "numeric", month: "short" };
  return new Intl.DateTimeFormat("en-GB", options).format(date);
}

/** "today at 07:04", "yesterday at 18:20", "on Saturday at 07:03", "on 12 Oct". */
export function foundWhen(iso: string, now: number): string {
  const date = new Date(iso);
  const midnight = (time: Date) =>
    new Date(time.getFullYear(), time.getMonth(), time.getDate()).getTime();
  const days = Math.round((midnight(new Date(now)) - midnight(date)) / 864e5);
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", options).format(date);
  const time = format({ hour: "2-digit", minute: "2-digit" });
  if (days <= 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  if (days < 7) return `on ${format({ weekday: "long" })} at ${time}`;
  return `on ${format({ day: "numeric", month: "short" })}`;
}

/** "today", "yesterday", "12 Oct", or "12 Oct 2025" in another year. */
export function dayWhen(iso: string, now: number): string {
  const date = new Date(iso);
  const today = new Date(now);
  const midnight = (time: Date) =>
    new Date(time.getFullYear(), time.getMonth(), time.getDate()).getTime();
  const days = Math.round((midnight(today) - midnight(date)) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

/** "12 Oct", or "12 Oct 2025" in another year. */
export function dateWhen(iso: string, now: number): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date(now).getFullYear()
      ? {}
      : { year: "numeric" }),
  }).format(date);
}

const FORMATS = {
  short: shortWhen,
  found: foundWhen,
  day: dayWhen,
  date: dateWhen,
};

// The time to the minute, shared by every RelativeDate on the page and
// ticking once a minute so "today" turns into "yesterday" at midnight.
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | undefined;

function subscribe(onTick: () => void) {
  listeners.add(onTick);
  ticker ??= setInterval(() => listeners.forEach((tick) => tick()), 60_000);
  return () => {
    listeners.delete(onTick);
    if (listeners.size > 0) return;
    clearInterval(ticker);
    ticker = undefined;
  };
}

const thisMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

/**
 * A time said relative to today, in the browser's time zone. As with
 * LocalDate, an inline script rewrites the server's text before the first
 * paint.
 */
export function RelativeDate({
  iso,
  kind,
  className,
}: {
  iso: string;
  kind: keyof typeof FORMATS;
  className?: string;
}) {
  const id = useId();
  const now = useSyncExternalStore(subscribe, thisMinute, thisMinute);
  const format = FORMATS[kind];
  return (
    <>
      <time
        id={id}
        dateTime={iso}
        className={className}
        suppressHydrationWarning
      >
        {format(iso, now)}
      </time>
      <InlineScript
        html={`{var n=document.getElementById(${JSON.stringify(id)});if(n)n.textContent=(${format.toString()})(${JSON.stringify(iso)},Date.now())}`}
      />
    </>
  );
}
