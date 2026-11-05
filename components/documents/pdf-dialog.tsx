"use client";

import { EyeIcon } from "lucide-react";
import dynamic from "next/dynamic";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

// PDF.js runs only in the browser, and loads only once a PDF is opened.
const PdfViewer = dynamic(
  () => import("./pdf-viewer").then((module) => module.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="grid flex-1 place-items-center bg-muted">
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner aria-hidden />
          Opening the PDF…
        </p>
      </div>
    ),
  },
);

type ViewerProps = {
  url: string;
  /** What the PDF is, for the window's heading. */
  title: string;
  description?: string;
};

function ViewerWindow({ url, title, description }: ViewerProps) {
  return (
    <DialogContent className="flex h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl max-sm:h-dvh max-sm:max-w-full max-sm:rounded-none max-sm:ring-0">
      <DialogHeader className="gap-1 border-b py-3 pr-12 pl-4">
        <DialogTitle className="truncate leading-normal">{title}</DialogTitle>
        {description ? (
          <DialogDescription className="truncate text-xs">
            {description}
          </DialogDescription>
        ) : null}
      </DialogHeader>
      <PdfViewer url={url} title={title} />
    </DialogContent>
  );
}

/** A button that opens a stored PDF in the app's own viewer. */
export function PdfDialog({
  label = "View PDF",
  size = "sm",
  ...viewer
}: ViewerProps & {
  label?: React.ReactNode;
  size?: "xs" | "sm" | "default";
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size={size} />}>
        <EyeIcon aria-hidden data-icon="inline-start" />
        {label}
      </DialogTrigger>
      <ViewerWindow {...viewer} />
    </Dialog>
  );
}

/** The same viewer, opened by something else, such as a card. */
export function PdfViewerDialog({
  open,
  onOpenChange,
  ...viewer
}: ViewerProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ViewerWindow {...viewer} />
    </Dialog>
  );
}
