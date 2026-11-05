"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";

import { saveSetupProfileAction } from "@/app/setup/actions";
import { applyServerErrors } from "@/components/form-fields";
import {
  BasicsSection,
  CertificationsSection,
  EducationSection,
  ExperienceSection,
  LanguagesSection,
  LinksSection,
  ProjectsSection,
  SkillsSection,
} from "@/components/profile/profile-form";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { callAction } from "@/lib/call-action";
import {
  emptyMasterProfile,
  masterProfileSchema,
  type MasterProfile,
} from "@/lib/schemas/profile";
import type { SetupCvPath } from "@/lib/schemas/setup";
import {
  clearProfileDraft,
  readProfileDraft,
  writeProfileDraft,
} from "@/lib/setup/profile-draft";
import { profileReady } from "@/lib/setup/progress";
import { setupKey } from "@/lib/setup/queries";
import { cn } from "@/lib/utils";

type Part = {
  title: string;
  /** The parts of the profile this part edits, checked before Next. */
  fields: (keyof MasterProfile)[];
};

/** Everything a CV has, a few sections at a time. */
const PARTS: Part[] = [
  { title: "About you", fields: ["basics"] },
  { title: "Experience", fields: ["experience"] },
  { title: "Skills", fields: ["skills"] },
  { title: "Education", fields: ["education", "certifications"] },
  { title: "Links and more", fields: ["links", "projects", "languages"] },
];

const NOTHING_YET =
  "Add at least one role, school or skill, so the agents have something to work from.";

/** This browser's storage, or null when it's turned off. */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The first part with something to fix, from error paths such as `experience.0.title`. */
function firstPartWith(paths: string[]): number | null {
  const tops = new Set(paths.map((path) => path.split(".")[0]));
  const index = PARTS.findIndex((part) =>
    part.fields.some((field) => tops.has(field)),
  );
  return index === -1 ? null : index;
}

/**
 * The profile, as setup's form: about you, experience, skills, education,
 * then links and the rest, each part checked before the next. From the form
 * path, saving starts the ATS-friendly CV; after an upload, it saves the
 * fixes. What's typed stays in this browser until it's saved.
 */
export function SetupProfileForm({
  path,
  profile,
  onSaved,
  onCancel,
}: {
  path: SetupCvPath;
  /** The saved profile, or null to start empty. */
  profile: MasterProfile | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const form = useForm<MasterProfile>({
    resolver: zodResolver(masterProfileSchema),
    defaultValues: profile ?? emptyMasterProfile(),
  });
  const { control } = form;
  const queryClient = useQueryClient();
  const base = profile?.basics.id ?? null;
  const [part, setPart] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const last = part === PARTS.length - 1;

  // A draft from before a reload wins over the saved profile, then every
  // change is kept as the draft until it's saved.
  useEffect(() => {
    const storage = browserStorage();
    if (!storage) return;
    const draft = readProfileDraft(storage, base);
    if (draft) form.reset(draft, { keepDefaultValues: true });
    return form.subscribe({
      formState: { values: true },
      callback: ({ values }) => writeProfileDraft(storage, base, values),
    });
  }, [form, base]);

  function show(next: number) {
    setPart(next);
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  async function next() {
    setFormError(null);
    if (await form.trigger(PARTS[part].fields)) {
      show(part + 1);
    }
  }

  function showFirstError(errors: FieldErrors<MasterProfile>) {
    const index = firstPartWith(Object.keys(errors));
    if (index !== null) show(index);
  }

  async function save(values: MasterProfile) {
    setFormError(null);
    if (!profileReady(values)) {
      setFormError(NOTHING_YET);
      return;
    }
    const result = await callAction(() => saveSetupProfileAction(path, values));
    if (!result.ok) {
      applyServerErrors(form.setError, result.errors);
      setFormError(result.errors.formErrors[0] ?? null);
      const index = firstPartWith(Object.keys(result.errors.fieldErrors));
      if (index !== null) show(index);
      return;
    }
    const storage = browserStorage();
    if (storage) clearProfileDraft(storage);
    form.reset(values);
    await queryClient.invalidateQueries({ queryKey: setupKey });
    onSaved();
  }

  const { errors, isSubmitting, submitCount } = form.formState;
  const hasErrors = submitCount > 0 && Object.keys(errors).length > 0;
  return (
    <form
      onSubmit={(event) => {
        if (last) {
          void form.handleSubmit(save, showFirstError)(event);
          return;
        }
        event.preventDefault();
        void next();
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      <div ref={top} className="flex scroll-mt-24 flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground tabular-nums">
          Part {part + 1} of {PARTS.length}: {PARTS[part].title}
        </p>
        <ol className="flex gap-1" aria-hidden>
          {PARTS.map((candidate, index) => (
            <li
              key={candidate.title}
              className={cn(
                "h-1 flex-1 rounded-full bg-muted",
                index <= part && "bg-primary",
              )}
            />
          ))}
        </ol>
      </div>

      {part === 0 ? <BasicsSection control={control} /> : null}
      {part === 1 ? <ExperienceSection control={control} /> : null}
      {part === 2 ? <SkillsSection control={control} /> : null}
      {part === 3 ? (
        <>
          <EducationSection control={control} />
          <CertificationsSection control={control} />
        </>
      ) : null}
      {part === 4 ? (
        <>
          <LinksSection control={control} />
          <ProjectsSection control={control} />
          <LanguagesSection control={control} />
        </>
      ) : null}

      <div className="flex flex-col gap-3 border-t pt-4">
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-destructive"
        >
          {formError ??
            (hasErrors
              ? "Some fields need fixing. They're marked in red."
              : null)}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {part > 0 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => show(part - 1)}
              >
                <ArrowLeftIcon aria-hidden data-icon="inline-start" />
                Back
              </Button>
            ) : null}
            {onCancel ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  const storage = browserStorage();
                  if (storage) clearProfileDraft(storage);
                  onCancel();
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : null}
            {!last
              ? "Next"
              : path === "form"
                ? "Save and write my CV"
                : "Save changes"}
            {last ? null : (
              <ArrowRightIcon aria-hidden data-icon="inline-end" />
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
