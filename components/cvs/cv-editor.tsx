"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PlusIcon,
  SaveIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import {
  Controller,
  FormProvider,
  useFieldArray,
  useForm,
  useFormContext,
  useWatch,
} from "react-hook-form";

import { saveCvEditAction } from "@/app/(app)/cvs/actions";
import { applyServerErrors, errorList } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { callAction } from "@/lib/call-action";
import type { EditorEntry, EditorLine } from "@/lib/cvs/editor";
import type { CvEditorData } from "@/lib/dal/cv-editor";
import { CV_LENGTHS } from "@/lib/schemas/cv-builder";
import {
  EDIT_SKILLS_MAX,
  EDITOR_SECTIONS,
  cvEditFormSchema,
  type CvEditForm,
  type CvEditSource,
} from "@/lib/schemas/cv-editor";
import { cn } from "@/lib/utils";

import { DesignPicker } from "./design-picker";
import { LENGTH_LABELS, SECTION_LABELS } from "./labels";

// The CV editor: the CV laid out as it prints, with a button on every line
// to move or remove it, and the profile's other lines a click away under
// each role. The title and summary are typed; every other line comes from
// the profile or the CV being edited, so nothing new is claimed. Nothing
// here calls Claude.

const PAPER =
  "flex w-full min-w-0 flex-col gap-6 rounded-lg border bg-card px-4 py-6 text-[0.8125rem] leading-relaxed shadow-sm sm:px-9 sm:py-9";

/** Line buttons show on hover or focus with a mouse, and always on touch. */
const ON_HOVER =
  "transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within/line:opacity-100 pointer-fine:group-hover/line:opacity-100";

type EntryList = "experience" | "projects";

export function CvEditor({
  source,
  data,
}: {
  source: CvEditSource;
  data: CvEditorData;
}) {
  const router = useRouter();
  const form = useForm<CvEditForm>({
    resolver: zodResolver(cvEditFormSchema),
    defaultValues: data.form,
  });
  const { formState } = form;
  // Set once the CV is saved: the button stays busy until its page opens.
  const [opening, setOpening] = useState(false);
  const busy = formState.isSubmitting || opening;

  const submit = form.handleSubmit(async (values) => {
    const result = await callAction(() => saveCvEditAction(source, values));
    if (!result.ok) {
      applyServerErrors(form.setError, result.errors);
      return;
    }
    setOpening(true);
    router.push(result.href);
  });

  const serverError = formState.errors.root?.server?.message;
  const hasFieldErrors = Object.keys(formState.errors).some(
    (key) => key !== "root",
  );
  const intoKit = data.saveAs.kind === "version";

  return (
    <FormProvider {...form}>
      <form
        onSubmit={(event) => {
          form.clearErrors();
          if (busy) {
            event.preventDefault();
            return;
          }
          return submit(event);
        }}
        noValidate
        className="flex flex-col gap-4"
      >
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <article aria-label="Your CV" className={PAPER}>
            <Header data={data} />
            <Summary profileSummary={data.profileSummary} />
            <Entries
              list="experience"
              title="Experience"
              entries={data.catalogue.roles}
            />
            {data.catalogue.projects.length > 0 ? (
              <Entries
                list="projects"
                title="Projects"
                entries={data.catalogue.projects}
              />
            ) : null}
            <Skills skills={data.catalogue.skills} />
            <WholeSections data={data} />
          </article>
          {/* After the CV on a phone, beside it on a wide screen. */}
          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20">
            <SaveNote data={data} />
            <DesignField />
            {intoKit ? null : <LengthField />}
          </aside>
        </div>

        <div className="sticky bottom-(--tab-bar-height) z-10 -mx-4 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:bottom-0">
          <p role="status" aria-live="polite" className="text-sm">
            {serverError ? (
              <span className="text-destructive">{serverError}</span>
            ) : formState.submitCount > 0 && hasFieldErrors ? (
              <span className="text-destructive">
                Some parts need fixing. They&apos;re marked in red.
              </span>
            ) : (
              <span className="text-muted-foreground">
                Free: no Claude call. The PDF is ready in a few seconds.
              </span>
            )}
          </p>
          <Button type="submit" aria-disabled={busy || undefined}>
            {busy ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : (
              <SaveIcon aria-hidden data-icon="inline-start" />
            )}
            {data.saveAs.kind === "version"
              ? `Save as version ${data.saveAs.version}`
              : "Save as a new CV"}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

// ---------------------------------------------------------------------------
// Beside the CV
// ---------------------------------------------------------------------------

function SaveNote({ data }: { data: CvEditorData }) {
  const { saveAs } = data;
  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm shadow-xs">
      <h2 className="font-semibold">What saving does</h2>
      {saveAs.kind === "version" ? (
        <p className="text-muted-foreground">
          It becomes version {saveAs.version} of the CV for {saveAs.title} at{" "}
          {saveAs.company}. The apply kit and the form filler send it from then
          on; the earlier versions stay.
        </p>
      ) : (
        <p className="text-muted-foreground">
          It&apos;s saved as a new CV on the General tab. {data.from} stays as
          it is.
        </p>
      )}
      <p className="text-muted-foreground">
        Missing a line? Add it on the{" "}
        <Link
          href="/profile"
          className="font-medium text-primary-ink underline-offset-4 hover:underline"
        >
          Profile
        </Link>{" "}
        page and it shows up here.
      </p>
    </section>
  );
}

function DesignField() {
  const { control } = useFormContext<CvEditForm>();
  return (
    <Controller
      control={control}
      name="template"
      render={({ field, fieldState }) => (
        <FieldSet
          data-invalid={fieldState.invalid || undefined}
          className="rounded-xl border bg-card p-4 shadow-xs"
        >
          <FieldLegend variant="label">Design</FieldLegend>
          <FieldDescription id="design-description">
            All of them are one column an applicant tracking system reads in
            order.
          </FieldDescription>
          <DesignPicker
            id="design"
            name={field.name}
            value={field.value}
            onChange={field.onChange}
            invalid={fieldState.invalid}
            describedBy="design-description"
            compact
          />
          {fieldState.invalid && (
            <FieldError errors={errorList(fieldState.error)} />
          )}
        </FieldSet>
      )}
    />
  );
}

function LengthField() {
  const { control } = useFormContext<CvEditForm>();
  return (
    <Controller
      control={control}
      name="length"
      render={({ field, fieldState }) => (
        <FieldSet
          data-invalid={fieldState.invalid || undefined}
          className="rounded-xl border bg-card p-4 shadow-xs"
        >
          <FieldLegend variant="label">Length</FieldLegend>
          <FieldDescription>
            If it runs longer, the oldest roles&apos; last lines are left out.
          </FieldDescription>
          <RadioGroup
            name={field.name}
            value={field.value}
            onValueChange={(value) => field.onChange(value)}
            className="gap-2"
          >
            {CV_LENGTHS.map((length) => (
              <FieldLabel key={length} htmlFor={`length-${length}`}>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>{LENGTH_LABELS[length].title}</FieldTitle>
                  </FieldContent>
                  <RadioGroupItem value={length} id={`length-${length}`} />
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>
          {fieldState.invalid && (
            <FieldError errors={errorList(fieldState.error)} />
          )}
        </FieldSet>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// The CV
// ---------------------------------------------------------------------------

function SectionHeading({
  id,
  children,
  aside,
}: {
  id: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b pb-1">
      <h2
        id={id}
        className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase"
      >
        {children}
      </h2>
      {aside}
    </div>
  );
}

function Header({ data }: { data: CvEditorData }) {
  const { control } = useFormContext<CvEditForm>();
  return (
    <header className="flex flex-col gap-1.5">
      <p className="text-2xl font-semibold tracking-tight">{data.name}</p>
      <Controller
        control={control}
        name="title"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid || undefined}>
            <Input
              {...field}
              id="title"
              aria-label="Title under your name"
              aria-invalid={fieldState.invalid || undefined}
              aria-describedby={fieldState.invalid ? "title-error" : undefined}
              placeholder="Senior Frontend Engineer"
              className="h-8 max-w-md border-dashed px-2 text-sm font-medium text-primary"
            />
            {fieldState.invalid && (
              <FieldError
                id="title-error"
                errors={errorList(fieldState.error)}
              />
            )}
          </Field>
        )}
      />
      {data.contact.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {data.contact.join(" · ")}
        </p>
      ) : null}
    </header>
  );
}

function Summary({ profileSummary }: { profileSummary: string }) {
  const { control, setValue } = useFormContext<CvEditForm>();
  const summary = useWatch({ control, name: "summary" });
  const canRestore =
    profileSummary.trim() !== "" && summary.trim() !== profileSummary.trim();
  return (
    <section aria-labelledby="summary-heading" className="flex flex-col gap-2">
      <SectionHeading
        id="summary-heading"
        aside={
          canRestore ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() =>
                setValue("summary", profileSummary, { shouldDirty: true })
              }
            >
              Use your profile&apos;s summary
            </Button>
          ) : null
        }
      >
        Summary
      </SectionHeading>
      <Controller
        control={control}
        name="summary"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid || undefined}>
            <Textarea
              {...field}
              id="summary"
              aria-labelledby="summary-heading"
              aria-describedby="summary-description"
              aria-invalid={fieldState.invalid || undefined}
              rows={3}
              placeholder="Two or three sentences on who you are and what you do best"
              className="min-h-20 border-dashed text-[0.8125rem] leading-relaxed"
            />
            <FieldDescription id="summary-description" className="text-xs">
              In your own words. Leave it empty for a CV without a summary.
            </FieldDescription>
            {fieldState.invalid && (
              <FieldError errors={errorList(fieldState.error)} />
            )}
          </Field>
        )}
      />
    </section>
  );
}

function Entries({
  list,
  title,
  entries,
}: {
  list: EntryList;
  title: string;
  entries: EditorEntry[];
}) {
  const id = `${list}-heading`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <SectionHeading id={id}>{title}</SectionHeading>
      {entries.length === 0 ? (
        <p className="text-muted-foreground">None in your profile.</p>
      ) : (
        entries.map((entry, index) => (
          <EntryEditor key={entry.id} list={list} index={index} entry={entry} />
        ))
      )}
    </section>
  );
}

/** One role or project: its lines on the CV, and the ones to add. */
function EntryEditor({
  list,
  index,
  entry,
}: {
  list: EntryList;
  index: number;
  entry: EditorEntry;
}) {
  const { control } = useFormContext<CvEditForm>();
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: `${list}.${index}.lines`,
    keyName: "rhfKey",
  });
  const shown = useWatch({ control, name: `${list}.${index}.shown` });
  const lines = useWatch({ control, name: `${list}.${index}.lines` });
  const byRef = new Map(entry.lines.map((line) => [line.ref, line]));
  const onCv = new Set(lines.map((line) => line.ref));
  // A profile bullet the CV already says in other words isn't offered again.
  const cited = new Set(
    lines.flatMap((line) => byRef.get(line.ref)?.sources ?? []),
  );
  const available = entry.lines.filter(
    (line) =>
      !onCv.has(line.ref) &&
      !(line.from === "profile" && line.sources.some((id) => cited.has(id))),
  );

  return (
    <div data-entry className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span
          className={cn("font-semibold", !shown && "text-muted-foreground")}
        >
          {entry.title}
        </span>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          {entry.dates}
          <Controller
            control={control}
            name={`${list}.${index}.shown`}
            render={({ field }) => (
              <Switch
                size="sm"
                checked={field.value}
                onCheckedChange={field.onChange}
                aria-label={`Show ${entry.title} on the CV`}
              />
            )}
          />
        </span>
      </div>
      {shown ? (
        <>
          {fields.length > 0 ? (
            <ul className="flex flex-col">
              {fields.map((field, at) => (
                <LineRow
                  key={field.rhfKey}
                  line={byRef.get(field.ref)}
                  index={at}
                  count={fields.length}
                  onMove={move}
                  onRemove={remove}
                />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No lines: the CV shows only the title and dates.
            </p>
          )}
          <AddLines
            entryTitle={entry.title}
            noun={list === "experience" ? "role" : "project"}
            lines={available}
            onAdd={(ref) => append({ ref })}
          />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Left out of this CV.</p>
      )}
    </div>
  );
}

function LineRow({
  line,
  index,
  count,
  onMove,
  onRemove,
}: {
  line: EditorLine | undefined;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  const text = line?.text ?? "";
  const short = text.length > 40 ? `${text.slice(0, 40)}…` : text;
  return (
    <li className="group/line -mx-2 flex items-start gap-2 rounded-md px-2 py-0.5 hover:bg-muted/60 focus-within:bg-muted/60">
      <span
        aria-hidden
        className="mt-[0.6em] size-1 shrink-0 rounded-full bg-muted-foreground"
      />
      <span className="min-w-0 flex-1">{text}</span>
      <span className={cn("flex shrink-0 items-center", ON_HOVER)}>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
          aria-label={`Move up: ${short}`}
        >
          <ArrowUpIcon aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={index === count - 1}
          onClick={() => onMove(index, index + 1)}
          aria-label={`Move down: ${short}`}
        >
          <ArrowDownIcon aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={(event) => {
            const entry = event.currentTarget.closest("[data-entry]");
            onRemove(index);
            // The removed line took this button with it: keep focus nearby.
            requestAnimationFrame(() => {
              if (document.activeElement !== document.body) return;
              entry?.querySelector<HTMLElement>("[data-add-lines]")?.focus();
            });
          }}
          aria-label={`Remove: ${short}`}
          className="hover:text-destructive"
        >
          <XIcon aria-hidden />
        </Button>
      </span>
    </li>
  );
}

/** The lines that can go under a role or project, behind one button. */
function AddLines({
  entryTitle,
  noun,
  lines,
  onAdd,
}: {
  entryTitle: string;
  noun: "role" | "project";
  lines: EditorLine[];
  onAdd: (ref: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        data-add-lines
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="w-fit text-primary-ink"
      >
        <PlusIcon aria-hidden data-icon="inline-start" />
        {open
          ? "Hide the other lines"
          : `Add a line (${lines.length} more for this ${noun})`}
      </Button>
      {open ? (
        <ul
          id={listId}
          aria-label={`Lines to add to ${entryTitle}`}
          className="flex flex-col gap-1 rounded-lg border border-dashed p-2"
        >
          {lines.map((line) => (
            <li key={line.ref} className="flex items-start gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                onClick={() => onAdd(line.ref)}
                aria-label={`Add: ${line.text}`}
                className="mt-0.5"
              >
                <PlusIcon aria-hidden />
              </Button>
              <span className="min-w-0 flex-1 text-muted-foreground">
                {line.text}
                <span className="ml-1.5 text-[0.6875rem] whitespace-nowrap text-muted-foreground/80">
                  {line.from === "cv"
                    ? "· from this CV"
                    : "· from your profile"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Skills({ skills }: { skills: { id: string; name: string }[] }) {
  const { control } = useFormContext<CvEditForm>();
  const [adding, setAdding] = useState(false);
  const names = new Map(skills.map((skill) => [skill.id, skill.name]));
  const listId = useId();
  return (
    <section aria-labelledby="skills-heading" className="flex flex-col gap-2">
      <SectionHeading id="skills-heading">Skills</SectionHeading>
      <Controller
        control={control}
        name="skillIds"
        render={({ field, fieldState }) => {
          const chosen = new Set(field.value);
          const others = skills.filter((skill) => !chosen.has(skill.id));
          const full = field.value.length >= EDIT_SKILLS_MAX;
          return (
            <Field data-invalid={fieldState.invalid || undefined}>
              {field.value.length > 0 ? (
                <ul
                  aria-label="Skills on the CV"
                  className="flex flex-wrap gap-1.5"
                >
                  {field.value.map((id) => (
                    <li
                      key={id}
                      className="inline-flex items-center gap-0.5 rounded-full border bg-background py-0.5 pr-0.5 pl-2.5 text-xs"
                    >
                      {names.get(id) ?? id}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="size-5 rounded-full hover:text-destructive"
                        aria-label={`Remove ${names.get(id) ?? id}`}
                        onClick={() =>
                          field.onChange(
                            field.value.filter((skill) => skill !== id),
                          )
                        }
                      >
                        <XIcon aria-hidden className="size-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No skills: the CV leaves the section out.
                </p>
              )}
              {others.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-expanded={adding}
                  aria-controls={listId}
                  onClick={() => setAdding((value) => !value)}
                  className="w-fit text-primary-ink"
                >
                  <PlusIcon aria-hidden data-icon="inline-start" />
                  {adding
                    ? "Hide the other skills"
                    : `Add skills (${others.length} more in your profile)`}
                </Button>
              ) : null}
              {adding && others.length > 0 ? (
                <ul
                  id={listId}
                  aria-label="Skills to add"
                  className="flex flex-wrap gap-1.5 rounded-lg border border-dashed p-2"
                >
                  {others.map((skill) => (
                    <li key={skill.id}>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={full}
                        onClick={() =>
                          field.onChange([...field.value, skill.id])
                        }
                        className="rounded-full"
                      >
                        <PlusIcon aria-hidden data-icon="inline-start" />
                        {skill.name}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {fieldState.invalid && (
                <FieldError errors={errorList(fieldState.error)} />
              )}
            </Field>
          );
        }}
      />
    </section>
  );
}

/** Education, certifications and languages: shown whole, or left out. */
function WholeSections({ data }: { data: CvEditorData }) {
  const { control } = useFormContext<CvEditForm>();
  const { sections } = data.catalogue;
  const present = EDITOR_SECTIONS.filter(
    (section) => sections[section].length > 0,
  );
  return (
    <Controller
      control={control}
      name="sections"
      render={({ field }) => (
        <>
          {present.map((section) => {
            const on = field.value.includes(section);
            const toggle = (checked: boolean) =>
              field.onChange(
                EDITOR_SECTIONS.filter((other) =>
                  other === section ? checked : field.value.includes(other),
                ),
              );
            const id = `${section}-heading`;
            return (
              <section
                key={section}
                aria-labelledby={id}
                className="flex flex-col gap-2"
              >
                <SectionHeading
                  id={id}
                  aside={
                    <Switch
                      size="sm"
                      checked={on}
                      onCheckedChange={toggle}
                      aria-label={`Show ${SECTION_LABELS[section]} on the CV`}
                    />
                  }
                >
                  {SECTION_LABELS[section]}
                </SectionHeading>
                {on ? (
                  section === "education" ? (
                    sections.education.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex flex-wrap justify-between gap-x-4"
                      >
                        <span>
                          <span className="font-medium">{entry.title}</span>
                          {entry.title && entry.institution ? ", " : null}
                          {entry.institution}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {entry.dates}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p>{sections[section].join(" · ")}</p>
                  )
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Left out of this CV.
                  </p>
                )}
              </section>
            );
          })}
        </>
      )}
    />
  );
}
