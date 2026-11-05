import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { CvEditor } from "@/components/cvs/cv-editor";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCvEditorStart } from "@/lib/dal/cv-editor";
import { requireUser } from "@/lib/dal/session";
import type { CvEditSource } from "@/lib/schemas/cv-editor";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Edit a CV" };

/**
 * The CV editor. `?cv=` starts from a CV on the General tab, `?kit=` from a
 * role's tailored CV, and neither from everything in the profile.
 */
export default function EditCvPage({ searchParams }: PageProps<"/cvs/edit">) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<EditorSkeleton />}>
        <EditorLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/cvs"
      className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ArrowLeftIcon aria-hidden className="size-4" />
      CVs
    </Link>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading the editor…</span>
      <Skeleton className="h-16 w-full max-w-md" />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Skeleton className="h-[40rem] rounded-lg" />
        <Skeleton className="h-48 rounded-xl max-lg:hidden" />
      </div>
    </div>
  );
}

function sourceFrom(params: Record<string, string | string[] | undefined>) {
  const id = z.uuid();
  if (params.kit !== undefined) {
    const kit = id.safeParse(params.kit);
    return kit.success ? ({ kind: "kit", id: kit.data } as const) : null;
  }
  if (params.cv !== undefined) {
    const cv = id.safeParse(params.cv);
    return cv.success ? ({ kind: "built", id: cv.data } as const) : null;
  }
  return { kind: "profile" } as const;
}

async function EditorLoader({
  searchParams,
}: {
  searchParams: PageProps<"/cvs/edit">["searchParams"];
}) {
  await requireUser();
  const source: CvEditSource | null = sourceFrom(await searchParams);
  if (!source) notFound();
  const start = await getCvEditorStart(source);
  if (start === null) notFound();

  if (start === "no_profile") {
    return (
      <>
        <PageHeader eyebrow={<BackLink />} title="New CV" />
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          <p>
            A CV is made from your profile, and there isn&apos;t one yet. Upload
            your current CV on the Profile page and the app reads it.
          </p>
          <Link href="/profile" className={cn(buttonVariants({ size: "sm" }))}>
            Go to Profile
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={<BackLink />}
        title={source.kind === "profile" ? "New CV" : "Edit CV"}
        description={
          source.kind === "profile"
            ? "It starts with everything in your profile, as your uploaded CV had it. Remove what this CV doesn't need, change the order, and add back any line."
            : `Starting from ${start.from}. Remove lines, change their order, and add any line from your profile.`
        }
      />
      <CvEditor key={JSON.stringify(source)} source={source} data={start} />
    </>
  );
}
