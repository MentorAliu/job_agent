import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { BackToProfile } from "@/components/profile/back-to-profile";
import { PreferencesForm } from "@/components/profile/preferences-form";
import { Spinner } from "@/components/ui/spinner";
import { getProfile } from "@/lib/dal/profile";
import { requireUser } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Job preferences" };

export default function PreferencesPage() {
  return (
    <>
      <PageHeader
        eyebrow={<BackToProfile />}
        title="Job preferences"
        description="Where you can work from, and the roles the searches look for. When you change the roles you want, seniority, stack or salary floor, the app scores your roles again and searches for new ones a few minutes later."
      />
      <Suspense fallback={<Spinner />}>
        <PreferencesLoader />
      </Suspense>
    </>
  );
}

async function PreferencesLoader() {
  await requireUser();
  const { preferences } = await getProfile();
  return <PreferencesForm defaultValues={preferences} />;
}
