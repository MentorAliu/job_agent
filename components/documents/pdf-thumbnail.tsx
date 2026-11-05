"use client";

import { useQuery } from "@tanstack/react-query";
import { FileTextIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { pdfFileQuery } from "@/lib/documents/queries";
import { cn } from "@/lib/utils";

import { loadPdfLib, type Lib } from "./pdfjs";

// A stored PDF's first page, drawn small, as a file browser shows a
// document. It's drawn with the viewer's PDF.js and the same settings (no
// scripts, no XFA), only once it scrolls near the screen, and the file it
// fetches is the one the viewer opens next.

/** The most pixels drawn per CSS pixel, so a sharp screen doesn't draw huge pages. */
const MAX_PIXEL_RATIO = 2;

export function PdfThumbnail({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [state, setState] = useState<"drawing" | "drawn" | "failed">("drawing");
  const file = useQuery({ ...pdfFileQuery(url), enabled: near });

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const bytes = file.data;
  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!bytes || !box || !canvas) return;
    const controller = new AbortController();
    const { signal } = controller;
    let task: ReturnType<Lib["getDocument"]> | null = null;
    let render: { cancel: () => void } | null = null;

    void (async () => {
      const { lib, worker } = await loadPdfLib();
      if (signal.aborted) return;
      task = lib.getDocument({
        // A copy: PDF.js hands the bytes it gets over to its worker.
        data: bytes.slice(),
        worker,
        enableXfa: false,
        verbosity: lib.VerbosityLevel.ERRORS,
      });
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      if (signal.aborted) return;
      const width = page.getViewport({ scale: 1 }).width;
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const viewport = page.getViewport({
        scale: (box.clientWidth * ratio) / width,
      });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const drawing = page.render({
        canvas,
        viewport,
        annotationMode: lib.AnnotationMode.ENABLE,
      });
      render = drawing;
      await drawing.promise;
      if (!signal.aborted) setState("drawn");
    })().catch((error: unknown) => {
      if (signal.aborted) return;
      console.warn("Couldn't draw a PDF's preview.", error);
      setState("failed");
    });

    return () => {
      controller.abort();
      render?.cancel();
      void task?.destroy();
    };
  }, [bytes]);

  const failed = file.isError || state === "failed";
  return (
    <div
      ref={boxRef}
      aria-hidden
      className={cn(
        "relative aspect-[210/297] overflow-hidden bg-white",
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        className={cn(
          "absolute inset-x-0 top-0 h-auto w-full transition-opacity duration-300",
          state === "drawn" ? "opacity-100" : "opacity-0",
        )}
      />
      {failed ? (
        <div className="absolute inset-0 grid place-items-center text-muted-foreground">
          <FileTextIcon className="size-8" />
        </div>
      ) : state !== "drawn" ? (
        <div className="absolute inset-0 flex flex-col gap-2 p-[8%]">
          <div className="h-[5%] w-1/2 animate-pulse rounded-sm bg-muted" />
          <div className="h-[3%] w-1/3 animate-pulse rounded-sm bg-muted" />
          <div className="mt-[6%] h-[2.5%] w-full animate-pulse rounded-sm bg-muted" />
          <div className="h-[2.5%] w-11/12 animate-pulse rounded-sm bg-muted" />
          <div className="h-[2.5%] w-4/5 animate-pulse rounded-sm bg-muted" />
        </div>
      ) : null}
    </div>
  );
}
