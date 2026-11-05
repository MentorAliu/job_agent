"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/** Copies `text` to the clipboard, and says so for a moment. */
export function CopyButton({
  text,
  label = "Copy",
  context,
  size = "sm",
  variant = "outline",
  onCopied,
}: {
  text: string;
  label?: string;
  /** What is copied, for screen readers, such as the question it answers. */
  context?: string;
  size?: "xs" | "sm" | "default";
  variant?: "outline" | "ghost" | "secondary" | "default";
  /** After the text is on the clipboard. */
  onCopied?: () => void;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      disabled={text === ""}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
          onCopied?.();
        } catch {
          setState("failed");
        }
      }}
    >
      {state === "copied" ? (
        <CheckIcon aria-hidden data-icon="inline-start" />
      ) : (
        <CopyIcon aria-hidden data-icon="inline-start" />
      )}
      <span aria-live="polite">
        {state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Couldn't copy"
            : label}
      </span>
      {context ? <span className="sr-only">: {context}</span> : null}
    </Button>
  );
}
