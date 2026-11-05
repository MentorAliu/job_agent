"use client";

import { useSyncExternalStore } from "react";

import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { placeName, timeZoneGroups } from "@/lib/time-zones";

function subscribeToNothing() {
  return () => {};
}

function readBrowserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** This computer's time zone, after hydration (null on the server). */
export function useBrowserTimeZone(): string | null {
  return useSyncExternalStore(
    subscribeToNothing,
    readBrowserTimeZone,
    () => null,
  );
}

const NO_ZONES: string[] = [];
let cachedZoneNames: string[] | null = null;

/**
 * Every time zone name this browser knows. Only after hydration, since the
 * server's list can differ from the browser's.
 */
export function useTimeZoneNames(): string[] {
  return useSyncExternalStore(
    subscribeToNothing,
    () => {
      if (!cachedZoneNames) {
        try {
          cachedZoneNames = Intl.supportedValuesOf("timeZone");
        } catch {
          cachedZoneNames = NO_ZONES;
        }
      }
      return cachedZoneNames;
    },
    () => NO_ZONES,
  );
}

/**
 * Picks one time zone, grouped by region, with this computer's marked. Until
 * hydration it lists only the one picked, so the server and the browser draw
 * the same thing.
 */
export function TimeZoneSelect({
  value,
  onChange,
  className,
  ...props
}: Omit<React.ComponentProps<typeof NativeSelect>, "value" | "onChange"> & {
  value: string;
  onChange: (timeZone: string) => void;
}) {
  const browserZone = useBrowserTimeZone();
  const names = useTimeZoneNames();
  const label = (zone: string, place: string) =>
    zone === browserZone ? `${place} (this computer)` : place;
  return (
    <NativeSelect
      {...props}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={className}
    >
      {names.length === 0 ? (
        <NativeSelectOption value={value}>
          {label(value, value.includes("/") ? placeName(value) : value)}
        </NativeSelectOption>
      ) : (
        timeZoneGroups(names, [value, browserZone, "UTC"]).map((group) => (
          <NativeSelectOptGroup key={group.region} label={group.region}>
            {group.zones.map((zone) => (
              <NativeSelectOption key={zone.value} value={zone.value}>
                {label(zone.value, zone.label)}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
        ))
      )}
    </NativeSelect>
  );
}
