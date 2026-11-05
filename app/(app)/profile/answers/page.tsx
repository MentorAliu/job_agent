import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { AnswersForm } from "@/components/profile/answers-form";
import { BackToProfile } from "@/components/profile/back-to-profile";
import { Spinner } from "@/components/ui/spinner";
import { getProfile } from "@/lib/dal/profile";
import { requireUser } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Standard answers" };

export default function AnswersPage() {
  return (
    <>
      <PageHeader
        eyebrow={<BackToProfile />}
        title="Standard answers"
        description="What every application form asks. Kits use these answers as they are."
      />
      <Suspense fallback={<Spinner />}>
        <AnswersLoader />
      </Suspense>
    </>
  );
}

async function AnswersLoader() {
  await requireUser();
  const { answers } = await getProfile();
  return <AnswersForm defaultValues={answers} />;
}
