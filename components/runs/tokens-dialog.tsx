"use client";

import { ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** The month's full table of tokens and calls, behind a button. */
export function TokensDialog({
  description,
  children,
}: {
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="outline" size="sm" className="bg-card" />}
      >
        <ChevronRightIcon aria-hidden data-icon="inline-start" />
        Tokens and calls
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Tokens and calls</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="-mx-4 overflow-x-auto px-4">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
