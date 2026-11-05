import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { BrandMark } from "@/components/shell/brand";
import { SignInForm } from "@/components/sign-in-form";
import { ThemeToggle } from "@/components/theme";
import { Skeleton } from "@/components/ui/skeleton";
import { RETURN_TO_PARAM, returnPath } from "@/lib/auth/return-to";
import { announceSetupCode, ownerExists } from "@/lib/dal/owner";
import { getOptionalUser } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <main className="relative flex flex-1 items-center justify-center px-4 py-16">
      <ThemeToggle className="absolute top-4 right-4 bg-card" />
      <div className="flex w-full max-w-sm flex-col items-center">
        <BrandMark className="size-11 rounded-xl text-sm" />
        <h1 className="mt-4 mb-1 text-2xl font-semibold tracking-tight">
          Job Agent
        </h1>
        <Suspense fallback={<FormSkeleton />}>
          <SignInCard searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

/**
 * Signs in, or creates the account while this copy has none. Signing in
 * goes back to the page the owner asked for, when the proxy says which.
 */
async function SignInCard({
  searchParams,
}: Pick<PageProps<"/sign-in">, "searchParams">) {
  const next = (await searchParams)[RETURN_TO_PARAM];
  const back = returnPath(typeof next === "string" ? next : null);
  if (await getOptionalUser()) redirect(back ?? "/");
  if (await ownerExists()) return <SignInForm mode="sign-in" next={back} />;
  announceSetupCode();
  return <SignInForm mode="create" />;
}

function FormSkeleton() {
  return (
    <div className="flex w-full flex-col items-center gap-6">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
