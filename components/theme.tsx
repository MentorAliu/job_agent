"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useLayoutEffect, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  DARK_SCHEME_QUERY,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark() {
  return window.matchMedia(DARK_SCHEME_QUERY).matches;
}

function applyTheme(preference: ThemePreference) {
  const dark =
    preference === "dark" || (preference === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DARK_SCHEME_QUERY);
  listeners.add(onChange);
  media.addEventListener("change", onChange);
  // Another tab changed the choice.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    media.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Storage can be off (some private windows). The page still switches.
  }
  applyTheme(preference);
  for (const listener of listeners) listener();
}

/** The saved theme choice, and whether the page is light or dark right now. */
export function useTheme() {
  const preference = useSyncExternalStore<ThemePreference>(
    subscribe,
    readPreference,
    () => "system",
  );
  const systemDark = useSyncExternalStore(
    subscribe,
    systemPrefersDark,
    () => false,
  );
  const resolved: "light" | "dark" =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;
  return { preference, resolved };
}

/**
 * Keeps the `dark` class on <html> in step with the saved choice: when the
 * system theme changes, when another tab changes the choice, and after React's
 * development-only remount clears the class the head script set.
 */
export function ThemeWatcher() {
  useLayoutEffect(() => {
    const sync = () => applyTheme(readPreference());
    sync();
    return subscribe(sync);
  }, []);
  return null;
}

export function ThemeToggle({ className }: { className?: string }) {
  const { resolved } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      className={className}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => setThemePreference(next)}
    >
      {resolved === "dark" ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
