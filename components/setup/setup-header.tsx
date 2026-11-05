"use client";

import { LogOutIcon } from "lucide-react";

import { BrandMark } from "@/components/shell/brand";
import { useSignOut } from "@/components/shell/use-sign-out";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** Setup's own bar: the app's name, the theme, and a way to sign out. */
export function SetupHeader() {
  const { pending, signOut } = useSignOut();
  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-2.5 px-4 sm:px-6">
        <BrandMark />
        <p className="text-sm font-semibold">Job Agent</p>
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
        <p className="text-sm text-muted-foreground">Setup</p>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={signOut}
          >
            {pending ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : (
              <LogOutIcon aria-hidden data-icon="inline-start" />
            )}
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
