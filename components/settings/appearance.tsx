"use client";

import { setThemePreference, useTheme } from "@/components/theme";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { isThemePreference, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

import { SettingsCard } from "./settings-card";

const CHOICES: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Light, dark or the system's choice, kept in this browser. */
export function AppearanceCard() {
  const { preference } = useTheme();
  return (
    <SettingsCard
      title="Appearance"
      description="Saved on this device. The theme button in the sidebar switches it too."
    >
      <RadioGroup
        aria-label="Theme"
        value={preference}
        onValueChange={(value) => {
          if (isThemePreference(value)) setThemePreference(value);
        }}
        className="grid grid-cols-3 gap-2 sm:gap-3"
      >
        {CHOICES.map((choice) => (
          <label
            key={choice.value}
            className="flex cursor-pointer flex-col gap-2 rounded-xl border p-1.5 transition-colors hover:bg-muted/40 has-data-checked:border-primary has-data-checked:ring-1 has-data-checked:ring-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50 sm:p-2"
          >
            <ThemePreview theme={choice.value} />
            <span className="flex items-center gap-2 px-1 pb-0.5 text-sm font-medium">
              <RadioGroupItem value={choice.value} />
              {choice.label}
            </span>
          </label>
        ))}
      </RadioGroup>
    </SettingsCard>
  );
}

/** A tiny page in the theme's colors: a sidebar and a few lines of text. */
function ThemePreview({ theme }: { theme: ThemePreference }) {
  const half = (dark: boolean, className?: string) => (
    <span
      className={cn(
        "flex h-full gap-1.5 p-1.5",
        dark ? "bg-[#0f1115]" : "bg-[#f6f7f9]",
        className,
      )}
    >
      <span
        className={cn(
          "w-1/4 rounded-xs",
          dark ? "bg-[#1a1d23]" : "bg-[#e7e9ee]",
        )}
      />
      <span className="flex flex-1 flex-col gap-1 pt-1">
        <span
          className={cn(
            "h-1 w-3/4 rounded-full",
            dark ? "bg-[#4b5160]" : "bg-[#c4c8d1]",
          )}
        />
        <span
          className={cn(
            "h-1 w-full rounded-full",
            dark ? "bg-[#2f343e]" : "bg-[#dde0e6]",
          )}
        />
        <span
          className={cn(
            "h-1 w-1/2 rounded-full",
            dark ? "bg-[#2f343e]" : "bg-[#dde0e6]",
          )}
        />
      </span>
    </span>
  );
  return (
    <span
      aria-hidden
      className="flex h-14 overflow-hidden rounded-lg border sm:h-16"
    >
      {theme === "system" ? (
        <>
          {half(false, "w-1/2")}
          {half(true, "w-1/2")}
        </>
      ) : (
        half(theme === "dark", "w-full")
      )}
    </span>
  );
}
