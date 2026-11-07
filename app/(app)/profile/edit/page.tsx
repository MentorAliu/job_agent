import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { BackToProfile } from "@/components/profile/back-to-profile";
import { ProfileForm } from "@/components/profile/profile-form";
import { Skeleton } from "@/components/ui/skeleton";
import { getProfile } from "@/lib/dal/profile";
import { requireUser } from "@/lib/dal/session";
import { emptyMasterProfile } from "@/lib/schemas/profile";

export const metadata: Metadata = { title: "Edit profile" };

export default function EditProfilePage() {
  return (
    <>
      <PageHeader
        eyebrow={<BackToProfile />}
        title="Edit profile"
        description="Only for corrections. A new CV replaces everything here. When you save changes to your experience, skills or summary, the app scores your roles again and searches for new ones a few minutes later."
      />
      <Suspense fallback={<EditSkeleton />}>
        <EditLoader />
      </Suspense>
    </>
  );
}

function EditSkeleton() {
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[12.5rem_minmax(0,1fr)] xl:gap-x-6">
      <Skeleton className="h-80 rounded-xl max-xl:hidden" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}

async function EditLoader() {
  await requireUser();
  const { data } = await getProfile();
  return (
    // The form places its section menu and sections in this grid.
    <div className="grid items-start gap-4 xl:grid-cols-[12.5rem_minmax(0,1fr)] xl:gap-x-6">
      <ProfileForm
        defaultValues={data ?? emptyMasterProfile()}
        cvFileId={null}
      />
    </div>
  );
}
