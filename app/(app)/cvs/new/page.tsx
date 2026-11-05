import { ArrowLeftIcon, CheckIcon, PencilIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { BuildCvForm } from "@/components/cvs/build-cv-form";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCvBuilderStart, type CvBuilderStart } from "@/lib/dal/cvs";
import { requireUser } from "@/lib/dal/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Build a CV" };

export default function NewCvPage({ searchParams }: PageProps<"/cvs/new">) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <Link
            href="/cvs"
            className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ArrowLeftIcon aria-hidden className="size-4" />
            CVs
          </Link>
        }
        title="Build a CV"
        description="It's filled in from your profile, so you can build straight away. Paste a job posting to aim the CV at it."
      />
      <Suspense fallback={<BuilderSkeleton />}>
        <BuilderLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function BuilderSkeleton() {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex flex-col gap-4" aria-busy="true">
        <span className="sr-only">Loading the builder…</span>
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
      <Skeleton className="h-64 rounded-xl max-lg:hidden" />
    </div>
  );
}

/** `?from=` starts from an earlier CV's choices. */
async function BuilderLoader({
  searchParams,
}: {
  searchParams: PageProps<"/cvs/new">["searchParams"];
}) {
  await requireUser();
  const from = z.uuid().safeParse((await searchParams).from);
  const start = await getCvBuilderStart(from.success ? from.data : undefined);
  if (!start) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
        <p>
          A new CV is built from your profile, and there isn&apos;t one yet.
          Upload your current CV on the Profile page and the app reads it.
        </p>
        <Link href="/profile" className={cn(buttonVariants({ size: "sm" }))}>
          Go to Profile
        </Link>
      </div>
    );
  }
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <BuildCvForm defaultValues={start.form} skills={start.skills} />
      <FromProfile start={start} />
    </div>
  );
}

const BEST_PRACTICE = [
  "One column and standard headings, so applicant tracking systems read it in order",
  "A short summary aimed at the job title, with no clichés",
  "Action verbs and the numbers your profile gives",
  "The posting's own words, wherever your profile backs them",
  "Only facts from your profile, each one checked",
];

/** Where the CV's facts come from, and what every built CV follows. */
function FromProfile({ start }: { start: CvBuilderStart }) {
  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
        <h2 className="text-sm font-semibold">From your profile</h2>
        <div className="flex flex-col gap-0.5 text-sm">
          <p className="font-medium">{start.name}</p>
          {start.contact.map((line) => (
            <p key={line} className="truncate text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
        <Link
          href="/profile/edit"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "w-fit",
          )}
        >
          <PencilIcon aria-hidden data-icon="inline-start" />
          Edit profile
        </Link>
      </section>
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
        <h2 className="text-sm font-semibold">Every CV built here has</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {BEST_PRACTICE.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <CheckIcon
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-success-ink"
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
