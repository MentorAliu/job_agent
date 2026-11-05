"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  PencilLineIcon,
  UploadIcon,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import {
  buildAtsCvAction,
  chooseCvPathAction,
  confirmCvAction,
} from "@/app/setup/actions";
import { count, dateRange } from "@/components/profile/format";
import { uploadCv } from "@/components/profile/upload-cv";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useAfter } from "@/components/use-after";
import type { SetupState } from "@/lib/dal/setup";
import { CV_ACCEPT, MAX_CV_BYTES } from "@/lib/schemas/cv-upload";
import type { MasterProfile } from "@/lib/schemas/profile";
import type { SetupCvPath } from "@/lib/schemas/setup";
import { profileReady } from "@/lib/setup/progress";
import { setupKey } from "@/lib/setup/queries";
import { cn } from "@/lib/utils";

import { AtsCvPanel } from "./ats-cv-panel";
import { SetupProfileForm } from "./setup-profile-form";
import { StepCard } from "./step-card";
import { useSetupAction } from "./use-setup-action";

type Cv = SetupState["cv"];

/** After this long, a CV still being read gets a note on why it might be stuck. */
const SLOW_READ_MS = 2 * 60_000;

const SKILLS_SHOWN = 14;

const PATHS: Record<
  SetupCvPath,
  { icon: LucideIcon; title: string; description: string }
> = {
  upload: {
    icon: UploadIcon,
    title: "Upload your CV",
    description: `A PDF or Word file, up to ${MAX_CV_BYTES / 1024 / 1024} MB. The agent reads it into your profile in about a minute.`,
  },
  form: {
    icon: PencilLineIcon,
    title: "Fill in a form",
    description:
      "Type in your experience, skills and education. The agent then writes a professional, ATS-friendly CV from it.",
  },
};

/**
 * Step 3: the CV the agents work from. Upload one, or fill in the form and
 * let the agent write an ATS-friendly CV from it. Either way it ends with
 * Looks right on what's in the profile.
 */
export function CvStep({ cv, onContinue }: { cv: Cv; onContinue: () => void }) {
  const choose = useSetupAction();
  const other: SetupCvPath | null =
    cv.path === "upload" ? "form" : cv.path === "form" ? "upload" : null;

  return (
    <StepCard
      title="Your CV"
      description="The agents only ever write what's in your profile: every line of every CV and letter comes from it."
      footer={
        // Nothing to go on to or around until a way in is picked.
        other || cv.confirmed ? (
          <>
            {other ? (
              <Button
                type="button"
                variant="ghost"
                disabled={choose.pending}
                onClick={() =>
                  choose.run(() => chooseCvPathAction({ path: other }))
                }
              >
                {other === "form"
                  ? "Fill in a form instead"
                  : "Upload a CV instead"}
              </Button>
            ) : (
              <span />
            )}
            {cv.confirmed ? (
              <Button type="button" onClick={onContinue}>
                Continue
                <ArrowRightIcon aria-hidden data-icon="inline-end" />
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {cv.path === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["upload", "form"] as const).map((path) => (
            <PathCard
              key={path}
              path={path}
              disabled={choose.pending}
              onChoose={() => choose.run(() => chooseCvPathAction({ path }))}
            />
          ))}
        </div>
      ) : cv.path === "upload" ? (
        <UploadPath cv={cv} onContinue={onContinue} />
      ) : (
        <FormPath cv={cv} onContinue={onContinue} />
      )}
      {choose.error ? (
        <p role="alert" className="text-sm text-destructive">
          {choose.error}
        </p>
      ) : null}
    </StepCard>
  );
}

function PathCard({
  path,
  disabled,
  onChoose,
}: {
  path: SetupCvPath;
  disabled: boolean;
  onChoose: () => void;
}) {
  const { icon: Icon, title, description } = PATHS[path];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onChoose}
      className="flex flex-col items-start gap-2 rounded-lg border bg-card p-4 text-start transition-colors outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
    >
      <span
        aria-hidden
        className="grid size-9 place-items-center rounded-lg bg-primary-soft text-primary-ink"
      >
        <Icon className="size-4.5" />
      </span>
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-[0.8125rem] text-muted-foreground">
        {description}
      </span>
    </button>
  );
}

/** "5 roles, 21 skills and 1 school": what the profile has. */
function found(profile: MasterProfile): string {
  return `${count(profile.experience.length, "role")}, ${count(profile.skills.length, "skill")} and ${count(profile.education.length, "school")}`;
}

/** What the profile says now, short enough to check at a glance. */
function ProfileGlance({ profile }: { profile: MasterProfile }) {
  const { basics, experience, skills } = profile;
  const more = skills.length - SKILLS_SHOWN;
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3.5">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold">{basics.name || "No name yet"}</p>
        {basics.headline ? (
          <p className="text-[0.8125rem] text-muted-foreground">
            {basics.headline}
          </p>
        ) : null}
      </div>
      {experience.length > 0 ? (
        <ul className="flex flex-col gap-1 text-[0.8125rem]">
          {experience.slice(0, 4).map((role) => (
            <li key={role.id} className="flex flex-wrap gap-x-2">
              <span className="font-medium">
                {role.title}, {role.company}
              </span>
              <span className="text-muted-foreground">
                {dateRange(role.startDate, role.endDate, role.current)}
              </span>
            </li>
          ))}
          {experience.length > 4 ? (
            <li className="text-muted-foreground">
              and {count(experience.length - 4, "more role")}
            </li>
          ) : null}
        </ul>
      ) : null}
      {skills.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {skills.slice(0, SKILLS_SHOWN).map((skill) => (
            <Badge key={skill.id} variant="secondary">
              {skill.name}
            </Badge>
          ))}
          {more > 0 ? <Badge variant="outline">+{more}</Badge> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Looks right, with why it can't be pressed yet. */
function LooksRight({
  disabled,
  pending,
  error,
  label = "Looks right",
  onConfirm,
}: {
  disabled?: boolean;
  pending: boolean;
  error: string | null;
  label?: string;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" disabled={disabled || pending} onClick={onConfirm}>
        {pending ? (
          <Spinner aria-hidden data-icon="inline-start" />
        ) : (
          <CircleCheckIcon aria-hidden data-icon="inline-start" />
        )}
        {label}
      </Button>
      {error ? (
        <p role="alert" className="text-[0.8125rem] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Confirmed() {
  return (
    <p
      role="status"
      className="flex items-center gap-2 text-sm font-medium text-success-ink"
    >
      <CircleCheckIcon aria-hidden className="size-4" />
      Done. The agents will work from this profile.
    </p>
  );
}

function UploadPath({ cv, onContinue }: { cv: Cv; onContinue: () => void }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fixing, setFixing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const confirm = useSetupAction();
  const build = useSetupAction();
  const upload = useMutation({
    mutationFn: uploadCv,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: setupKey }),
  });
  const latest = cv.upload;
  const reading = upload.isPending || latest?.status === "pending";
  const slow = useAfter(
    latest?.status === "pending" ? latest.createdAt : null,
    SLOW_READ_MS,
  );
  const { profile } = cv;

  function pickFile() {
    // A new CV replaces the profile, so say so first when there is one.
    if (profile) setReplacing(true);
    else fileInput.current?.click();
  }

  function send(file: File) {
    setFixing(false);
    upload.mutate(file);
  }

  const picker = (
    <input
      ref={fileInput}
      type="file"
      accept={CV_ACCEPT}
      className="sr-only"
      tabIndex={-1}
      aria-label="CV file"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) send(file);
      }}
    />
  );

  const replaceDialog = (
    <Dialog open={replacing} onOpenChange={setReplacing}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replace your profile?</DialogTitle>
          <DialogDescription>
            The agent reads the new CV into your profile in place of what&apos;s
            there now, including any changes you made to it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            type="button"
            onClick={() => {
              setReplacing(false);
              fileInput.current?.click();
            }}
          >
            <UploadIcon aria-hidden data-icon="inline-start" />
            Choose a CV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const uploadError = upload.isError ? (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>The upload didn&apos;t go through</AlertTitle>
      <AlertDescription>{upload.error.message}</AlertDescription>
    </Alert>
  ) : null;

  if (reading) {
    return (
      <div className="flex flex-col gap-3">
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg border bg-muted/40 p-3.5 text-[0.8125rem]"
        >
          <Spinner aria-hidden className="mt-0.5 shrink-0" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-medium">
              {upload.isPending
                ? "Uploading…"
                : `The agent is reading ${latest?.originalName ?? "your CV"}…`}
            </p>
            <p className="text-muted-foreground">
              {slow
                ? "This is taking longer than usual. Check that the background worker (Inngest) is running, or upload the CV again."
                : "This usually takes under a minute. You can leave this page; it carries on."}
            </p>
          </div>
        </div>
        {slow ? (
          <div>
            <Button type="button" variant="outline" onClick={pickFile}>
              <UploadIcon aria-hidden data-icon="inline-start" />
              Upload it again
            </Button>
          </div>
        ) : null}
        {picker}
        {replaceDialog}
      </div>
    );
  }

  const readFailed =
    latest?.status === "failed" ? (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>
          The agent couldn&apos;t read {latest.originalName ?? "the CV"}
        </AlertTitle>
        <AlertDescription>
          {latest.error ??
            "Something went wrong. Try uploading it again, or as a PDF."}{" "}
          {profile
            ? "Your profile didn't change."
            : "Try again, upload it as a Word file, or fill in the form instead."}
        </AlertDescription>
      </Alert>
    ) : null;

  // Nothing to show yet: the place to drop or pick a file.
  if (!profile) {
    return (
      <div className="flex flex-col gap-3">
        {uploadError}
        {readFailed}
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) send(file);
          }}
          className={cn(
            "flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
            dragging && "border-primary bg-primary-soft/40",
          )}
        >
          <span
            aria-hidden
            className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary-ink"
          >
            <UploadIcon className="size-5" />
          </span>
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium">
              Drop your CV here, or choose it
            </p>
            <p className="text-[0.8125rem] text-muted-foreground">
              PDF or Word (.docx), up to {MAX_CV_BYTES / 1024 / 1024} MB
            </p>
          </div>
          <Button type="button" onClick={() => fileInput.current?.click()}>
            <UploadIcon aria-hidden data-icon="inline-start" />
            {latest ? "Upload again" : "Choose a CV"}
          </Button>
        </div>
        {picker}
      </div>
    );
  }

  // The CV was read, but there's too little in it to work from: finish it here.
  if (!profileReady(profile) || fixing) {
    return (
      <div className="flex flex-col gap-3">
        {readFailed}
        {!profileReady(profile) ? (
          <p className="text-[0.8125rem] text-muted-foreground">
            The agent found little in this CV. Add what&apos;s missing below, or
            upload another one.
          </p>
        ) : null}
        <SetupProfileForm
          key={profile.basics.id}
          path="upload"
          profile={profile}
          onSaved={() => setFixing(false)}
          onCancel={profileReady(profile) ? () => setFixing(false) : undefined}
        />
        <div>
          <Button type="button" variant="outline" onClick={pickFile}>
            <UploadIcon aria-hidden data-icon="inline-start" />
            Upload another CV
          </Button>
        </div>
        {picker}
        {replaceDialog}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {uploadError}
      {readFailed}
      <div className="flex flex-col gap-2">
        <p className="text-sm">
          <span className="font-medium">
            Found {found(profile)}
            {latest?.originalName ? ` in ${latest.originalName}` : ""}.
          </span>{" "}
          <span className="text-muted-foreground">Check it looks right.</span>
        </p>
        <ProfileGlance profile={profile} />
      </div>
      <AtsCvPanel
        atsCv={cv.atsCv}
        optional
        pending={build.pending}
        error={build.error}
        onBuild={() => build.run(buildAtsCvAction)}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setFixing(true)}
          >
            <PencilLineIcon aria-hidden data-icon="inline-start" />
            Fix something
          </Button>
          <Button type="button" variant="outline" onClick={pickFile}>
            <UploadIcon aria-hidden data-icon="inline-start" />
            Upload another CV
          </Button>
        </div>
        {cv.confirmed ? (
          <Confirmed />
        ) : (
          <LooksRight
            pending={confirm.pending}
            error={confirm.error}
            label="Looks right, continue"
            onConfirm={() => confirm.run(() => confirmCvAction({}), onContinue)}
          />
        )}
      </div>
      {picker}
      {replaceDialog}
    </div>
  );
}

function FormPath({ cv, onContinue }: { cv: Cv; onContinue: () => void }) {
  const { profile, atsCv } = cv;
  // The form shows first, and again for a change, until the CV is written.
  const [editing, setEditing] = useState(atsCv === null);
  const confirm = useSetupAction();
  const build = useSetupAction();

  if (editing || !profile) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[0.8125rem] text-muted-foreground">
          Five short parts. Only your name and one role, school or skill are
          needed; the more you add, the better the agents can match and write.
        </p>
        <SetupProfileForm
          key={profile?.basics.id ?? "new"}
          path="form"
          profile={profile}
          onSaved={() => setEditing(false)}
          onCancel={atsCv && profile ? () => setEditing(false) : undefined}
        />
      </div>
    );
  }

  const failed = atsCv?.status === "failed";
  const ready = atsCv?.status === "ready" && !atsCv.outdated;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Your profile: {found(profile)}.</p>
        <ProfileGlance profile={profile} />
      </div>
      <AtsCvPanel
        atsCv={atsCv}
        optional={false}
        pending={build.pending}
        error={build.error}
        onBuild={() => build.run(buildAtsCvAction)}
      />
      {!atsCv ? (
        <div>
          <Button
            type="button"
            disabled={build.pending}
            onClick={() => build.run(buildAtsCvAction)}
          >
            {build.pending ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : null}
            Write my CV
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => setEditing(true)}
        >
          <PencilLineIcon aria-hidden data-icon="inline-start" />
          Change something
        </Button>
        {cv.confirmed ? (
          <Confirmed />
        ) : failed ? (
          <LooksRight
            pending={confirm.pending}
            error={confirm.error}
            label="Continue without it"
            onConfirm={() =>
              confirm.run(
                () => confirmCvAction({ withoutAtsCv: true }),
                onContinue,
              )
            }
          />
        ) : (
          <LooksRight
            disabled={!ready}
            pending={confirm.pending}
            error={confirm.error}
            label="Looks right, continue"
            onConfirm={() => confirm.run(() => confirmCvAction({}), onContinue)}
          />
        )}
      </div>
    </div>
  );
}
