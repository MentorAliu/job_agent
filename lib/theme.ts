export type ThemePreference = "light" | "dark" | "system";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export const THEME_STORAGE_KEY = "theme";
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/**
 * Runs in <head> before the first paint, so a saved dark theme never flashes
 * light first. It does what applyTheme in components/theme.tsx does.
 */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var d=p==="dark"||(p!=="light"&&matchMedia(${JSON.stringify(DARK_SCHEME_QUERY)}).matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
