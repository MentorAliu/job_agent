"use client";

import { LogOutIcon } from "lucide-react";

import { setThemePreference, ThemeToggle, useTheme } from "@/components/theme";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isThemePreference, type ThemePreference } from "@/lib/theme";

import { useSignOut } from "./use-sign-out";

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match the system" },
];

/**
 * The sidebar's last row: who's signed in, with a menu for the theme and
 * signing out, and a one-click light or dark switch.
 */
export function AccountMenu({ name, email }: { name: string; email: string }) {
  const { preference } = useTheme();
  const { pending, signOut } = useSignOut();

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-popup-open:bg-sidebar-accent"
            />
          }
        >
          <Avatar className="size-7 after:hidden">
            <AvatarFallback className="bg-primary-soft text-xs font-semibold text-primary-ink">
              {name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[0.8125rem] font-medium">
              {name}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {email}
            </span>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={preference}
              onValueChange={(value) => {
                if (isThemePreference(value)) setThemePreference(value);
              }}
            >
              {THEMES.map((theme) => (
                <DropdownMenuRadioItem
                  key={theme.value}
                  value={theme.value}
                  closeOnClick
                >
                  {theme.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={pending} onClick={signOut}>
            <LogOutIcon aria-hidden />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ThemeToggle />
    </div>
  );
}
