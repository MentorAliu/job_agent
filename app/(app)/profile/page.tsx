import { SparklesIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { CvCard } from "@/components/profile/cv-card";
import {
  AboutCard,
  AnswersCard,
  ExperienceCard,
  PreferencesCard,
  SkillsCard,
} from "@/components/profile/profile-summary";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCvUpload, getLatestCvUpload, getProfile } from "@/lib/dal/profile";
import { requireUser } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <>
      <PageHeader
        title="Profile"
        description="What Claude knows about you. It comes from your CV; upload a new one and the profile updates itself."
        actions={
          <Link
            href="/cvs/new"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <SparklesIcon aria-hidden data-icon="inline-start" />
            Build a CV
          </Link>
        }
      />
      <Suspense fallback={<ProfileSkeleton />}>
        <ProfileLoader />
      </Suspense>
    </>
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-[4.5rem] rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

async function ProfileLoader() {
  await requireUser();
  const [profile, latestUpload] = await Promise.all([
    getProfile(),
    getLatestCvUpload(),
  ]);
  // The CV the saved profile came from, for the card at the top.
  const savedCv =
    profile.cvFileId === null
      ? null
      : profile.cvFileId === latestUpload?.id
        ? latestUpload
        : await getCvUpload(profile.cvFileId);
  return (
    <div className="flex flex-col gap-4">
      <CvCard savedCv={savedCv} latestUpload={latestUpload} />
      {profile.data ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <AboutCard profile={profile.data} />
            <ExperienceCard profile={profile.data} />
            <SkillsCard profile={profile.data} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <PreferencesCard preferences={profile.preferences} />
            <AnswersCard answers={profile.answers} />
          </div>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <PreferencesCard preferences={profile.preferences} />
          <AnswersCard answers={profile.answers} />
        </div>
      )}
    </div>
  );
}
