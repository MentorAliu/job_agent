"use client";

import "./pdf-viewer.css";

import { useQuery } from "@tanstack/react-query";
import {
  CircleAlertIcon,
  DownloadIcon,
  MoveHorizontalIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { pdfFileQuery } from "@/lib/documents/queries";
import { FetchError } from "@/lib/jobs/queries";
import { cn } from "@/lib/utils";

import { loadPdfJs, type Components, type Lib } from "./pdfjs";

// Mozilla's PDF.js, the viewer inside Firefox, set up only to show a file.
// Scripts in a PDF never run (there's no scripting manager), XFA and form
// fields aren't turned into fields, nothing can be edited, and a link opens
// in a new tab that can't reach this one. The file comes from the app's own
// Route Handlers, which check the session, and the app serves the worker.

type Viewer = InstanceType<Components["PDFViewer"]>;
/** PDF.js reads `abortSignal`, but its types leave it out. */
type ViewerOptions = ConstructorParameters<Components["PDFViewer"]>[0] & {
  abortSignal: AbortSignal;
};

/** How far the zoom buttons go. PDF.js's own limits are wider. */
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
/** The zooms that follow the window's width. */
const FIT_SCALES = new Set(["auto", "page-width"]);

/** What the message says when the file didn't load. */
function loadFailure(error: Error): string {
  if (error instanceof FetchError && error.status === 401) {
    return "You're signed out. Reload the page and sign in again.";
  }
  if (error instanceof FetchError && error.status === 404) {
    return "This file isn't there anymore. Reload the page to see the latest version.";
  }
  return "It didn't load. Check your connection, then close this and try again.";
}

/**
 * A stored PDF, read-only, with its page count, zoom and a download. Load it
 * with next/dynamic and `ssr: false`: PDF.js only runs in the browser.
 */
export function PdfViewer({ url, title }: { url: string; title: string }) {
  const file = useQuery(pdfFileQuery(url));
  const containerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [status, setStatus] = useState<"opening" | "open" | "failed">(
    "opening",
  );
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);

  const bytes = file.data;
  useEffect(() => {
    const container = containerRef.current;
    const pages = pagesRef.current;
    if (!bytes || !container || !pages) return;
    const controller = new AbortController();
    const { signal } = controller;
    let task: ReturnType<Lib["getDocument"]> | null = null;

    void (async () => {
      const { lib, components, worker } = await loadPdfJs();
      if (signal.aborted) return;
      const eventBus = new components.EventBus();
      const linkService = new components.PDFLinkService({
        eventBus,
        externalLinkTarget: components.LinkTarget.BLANK,
        externalLinkRel: "noopener noreferrer nofollow",
      });
      const options: ViewerOptions = {
        container,
        viewer: pages,
        eventBus,
        linkService,
        // Links work; form fields stay as drawn, and nothing can be edited.
        annotationMode: lib.AnnotationMode.ENABLE,
        annotationEditorMode: lib.AnnotationEditorType.DISABLE,
        abortSignal: signal,
      };
      const viewer = new components.PDFViewer(options);
      linkService.setViewer(viewer);
      viewerRef.current = viewer;
      eventBus.on(
        "pagesinit",
        () => {
          viewer.currentScaleValue = "auto";
          // Zooming scrolls to the first page's edge; start above it instead.
          container.scrollTop = 0;
        },
        { signal },
      );
      eventBus.on(
        "pagechanging",
        (event: { pageNumber: number }) => setPage(event.pageNumber),
        { signal },
      );
      eventBus.on(
        "scalechanging",
        (event: { scale: number }) => setScale(event.scale),
        { signal },
      );

      task = lib.getDocument({
        // A copy: PDF.js hands the bytes it gets over to its worker.
        data: bytes.slice(),
        worker,
        enableXfa: false,
        verbosity: lib.VerbosityLevel.ERRORS,
      });
      const pdf = await task.promise;
      if (signal.aborted) return;
      viewer.setDocument(pdf);
      linkService.setDocument(pdf);
      setPageCount(pdf.numPages);
      setStatus("open");
    })().catch((error: unknown) => {
      if (signal.aborted) return;
      console.warn("The PDF viewer couldn't open the file.", error);
      setStatus("failed");
    });

    // Keeps a fitted zoom fitted when the window changes size.
    const resize = new ResizeObserver(() => {
      const viewer = viewerRef.current;
      const preset = viewer?.currentScaleValue;
      if (viewer && viewer.pagesCount > 0 && preset && FIT_SCALES.has(preset)) {
        viewer.currentScaleValue = preset;
      }
    });
    resize.observe(container);

    return () => {
      controller.abort();
      resize.disconnect();
      viewerRef.current = null;
      void task?.destroy();
    };
  }, [bytes]);

  const failure = file.isError
    ? loadFailure(file.error)
    : status === "failed"
      ? "The viewer couldn't read this file. Download it to open it on your computer."
      : null;
  const open = status === "open" && !failure;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2 sm:px-4">
        <p className="text-xs text-muted-foreground tabular-nums">
          {open ? `Page ${page} of ${pageCount}` : null}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!open || scale <= MIN_SCALE}
            onClick={() => viewerRef.current?.decreaseScale()}
          >
            <ZoomOutIcon aria-hidden />
            <span className="sr-only">Zoom out</span>
          </Button>
          <span
            aria-live="polite"
            className="w-10 text-center text-xs text-muted-foreground tabular-nums"
          >
            {open ? `${Math.round(scale * 100)}%` : null}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!open || scale >= MAX_SCALE}
            onClick={() => viewerRef.current?.increaseScale()}
          >
            <ZoomInIcon aria-hidden />
            <span className="sr-only">Zoom in</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!open}
            onClick={() => {
              const viewer = viewerRef.current;
              if (viewer) viewer.currentScaleValue = "page-width";
            }}
          >
            <MoveHorizontalIcon aria-hidden data-icon="inline-start" />
            <span className="max-sm:sr-only">Fit width</span>
          </Button>
          {/* A link, not a button: it downloads a file. */}
          <a
            href={url}
            download
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "ml-1",
            )}
          >
            <DownloadIcon aria-hidden data-icon="inline-start" />
            <span className="max-sm:sr-only">Download</span>
          </a>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 bg-muted">
        {/* PDF.js needs an absolutely placed container that scrolls. */}
        <div
          ref={containerRef}
          role="region"
          aria-label={title}
          aria-busy={!open && !failure}
          tabIndex={0}
          className="absolute inset-0 overflow-auto outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          {/* PDF.js adds the pages here; React leaves this element alone. */}
          <div
            ref={pagesRef}
            className="pdfViewer py-2 [&_.canvasWrapper]:shadow-sm"
          />
        </div>
        {failure ? (
          <div className="absolute inset-0 grid place-items-center p-4">
            <Alert variant="destructive" className="max-w-md">
              <CircleAlertIcon aria-hidden />
              <AlertTitle>Couldn&apos;t open the PDF</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          </div>
        ) : !open ? (
          <div className="absolute inset-0 grid place-items-center">
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Spinner aria-hidden />
              Opening the PDF…
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
