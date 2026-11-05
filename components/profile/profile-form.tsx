"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import {
  useFieldArray,
  useForm,
  useFormState,
  useWatch,
  type Control,
} from "react-hook-form";

import { saveProfileAction } from "@/app/(app)/profile/actions";
import {
  CheckboxField,
  TagsField,
  TextField,
  useServerSubmit,
} from "@/components/form-fields";
import { SaveBar } from "@/components/profile/save-bar";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import {
  masterProfileSchema,
  newFactId,
  type MasterProfile,
} from "@/lib/schemas/profile";

import { EmptyList, FormSection, ItemButtons } from "./form-parts";
import { count, dateRange, formatMonth } from "./format";
import {
  CollapsibleItem,
  FactsNote,
  ItemSummary,
  SectionMenu,
} from "./profile-items";

type ProfileControl = Control<MasterProfile>;

/** The parts of the profile whose entries open and close. */
type EntryList = "experience" | "projects" | "education" | "certifications";

type EntryProps = {
  control: ProfileControl;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  defaultOpen: boolean;
};

const DATE_PLACEHOLDER = "YYYY-MM";

/** Padding for a list's empty note in a section whose body runs edge to edge. */
const FLUSH_EMPTY = "px-4 py-4 sm:px-5";

/**
 * The master profile review form. `cvFileId` is the CV upload the values came
 * from, or null when they are the saved profile.
 *
 * It lays itself into the page's grid: the "On this page" menu in the left
 * column on wide screens, and the sections under the CV card.
 */
export function ProfileForm({
  defaultValues,
  cvFileId,
}: {
  defaultValues: MasterProfile;
  cvFileId: string | null;
}) {
  const form = useForm<MasterProfile>({
    resolver: zodResolver(masterProfileSchema),
    defaultValues,
  });
  const { control } = form;

  const { onSubmit, savedAt } = useServerSubmit(form, (values) =>
    saveProfileAction(cvFileId, values),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="contents">
      <aside className="flex flex-col gap-4 max-xl:hidden xl:sticky xl:top-20 xl:col-start-1 xl:row-span-2 xl:row-start-1">
        <ProfileMenu control={control} />
        <FactsNote />
      </aside>
      <div className="flex min-w-0 flex-col gap-4 xl:col-start-2 xl:row-start-2">
        <BasicsSection control={control} />
        <ExperienceSection control={control} />
        <SkillsSection control={control} />
        <ProjectsSection control={control} />
        <EducationSection control={control} />
        <CertificationsSection control={control} />
        <LanguagesSection control={control} />
        <LinksSection control={control} />
        <SaveBar
          form={form}
          savedAt={savedAt}
          label={cvFileId ? "Save profile from this CV" : "Save profile"}
        />
      </div>
    </form>
  );
}

/** The section list, with how many entries each part has as you edit. */
function ProfileMenu({ control }: { control: ProfileControl }) {
  const [
    experience,
    skills,
    projects,
    education,
    certifications,
    languages,
    links,
  ] = useWatch({
    control,
    name: [
      "experience",
      "skills",
      "projects",
      "education",
      "certifications",
      "languages",
      "links",
    ],
  });
  return (
    <SectionMenu
      sections={[
        { id: "basics", label: "Basics" },
        { id: "experience", label: "Experience", count: experience.length },
        { id: "skills", label: "Skills", count: skills.length },
        { id: "projects", label: "Projects", count: projects.length },
        { id: "education", label: "Education", count: education.length },
        {
          id: "certifications",
          label: "Certifications",
          count: certifications.length,
        },
        { id: "languages", label: "Languages", count: languages.length },
        { id: "links", label: "Links", count: links.length },
      ]}
    />
  );
}

/** Whether an entry has a field to fix, so it stays open. */
function useEntryInvalid(
  control: ProfileControl,
  list: EntryList,
  index: number,
): boolean {
  const { errors } = useFormState({ control, name: `${list}.${index}` });
  return Boolean(errors[list]?.[index]);
}

/** "5 roles · 23 bullets", as the roles and their bullets change. */
function BulletsMeta({
  control,
  list,
  noun,
}: {
  control: ProfileControl;
  list: "experience" | "projects";
  noun: string;
}) {
  const entries = useWatch({ control, name: list });
  const bullets = entries.reduce(
    (sum, entry) => sum + entry.highlights.length,
    0,
  );
  return `${count(entries.length, noun)} · ${count(bullets, "bullet")}`;
}

export function BasicsSection({ control }: { control: ProfileControl }) {
  return (
    <FormSection id="basics" title="Basics">
      <FieldGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <TextField
          control={control}
          name="basics.name"
          label="Name"
          autoComplete="name"
          className="lg:col-span-3"
        />
        <TextField
          control={control}
          name="basics.headline"
          label="Headline"
          placeholder="Senior Frontend Engineer"
          className="lg:col-span-3"
        />
        <TextField
          control={control}
          name="basics.email"
          label="Email"
          type="email"
          autoComplete="email"
          className="lg:col-span-2"
        />
        <TextField
          control={control}
          name="basics.phone"
          label="Phone"
          type="tel"
          autoComplete="tel"
          className="lg:col-span-2"
        />
        <TextField
          control={control}
          name="basics.location"
          label="Location"
          placeholder="Lisbon, Portugal"
          className="sm:col-span-2"
        />
        <TextField
          control={control}
          name="basics.summary"
          label="Summary"
          multiline
          rows={4}
          className="sm:col-span-2 lg:col-span-6"
        />
      </FieldGroup>
    </FormSection>
  );
}

export function ExperienceSection({ control }: { control: ProfileControl }) {
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "experience",
    keyName: "rhfKey",
  });
  // A role just added starts open, with its first field focused.
  const [added, setAdded] = useState<string | null>(null);

  return (
    <FormSection
      id="experience"
      title="Experience"
      meta={
        fields.length > 0 ? (
          <BulletsMeta control={control} list="experience" noun="role" />
        ) : undefined
      }
      description="Every role on your CV. Tailored CVs only ever use what's here."
      addLabel="Add role"
      onAdd={() => {
        const id = newFactId("role");
        setAdded(id);
        append({
          id,
          title: "",
          company: "",
          location: "",
          startDate: "",
          endDate: "",
          current: false,
          summary: "",
          highlights: [],
          technologies: [],
        });
      }}
      flush
    >
      {fields.length === 0 && (
        <EmptyList className={FLUSH_EMPTY}>No roles yet.</EmptyList>
      )}
      {fields.map((field, index) => (
        <RoleItem
          key={field.rhfKey}
          control={control}
          index={index}
          count={fields.length}
          onMove={move}
          onRemove={remove}
          defaultOpen={index === 0 || field.id === added}
        />
      ))}
    </FormSection>
  );
}

function RoleItem({
  control,
  index,
  count: total,
  onMove,
  onRemove,
  defaultOpen,
}: EntryProps) {
  const [title, company] = useWatch({
    control,
    name: [`experience.${index}.title`, `experience.${index}.company`],
  });
  const label =
    [title, company].filter(Boolean).join(" at ") || `Role ${index + 1}`;
  const invalid = useEntryInvalid(control, "experience", index);

  return (
    <CollapsibleItem
      summary={<RoleSummary control={control} index={index} />}
      label={label}
      defaultOpen={defaultOpen}
      invalid={invalid}
      index={index}
      count={total}
      onMove={onMove}
      onRemove={onRemove}
    >
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={control}
          name={`experience.${index}.title`}
          label="Job title"
        />
        <TextField
          control={control}
          name={`experience.${index}.company`}
          label="Company"
        />
        <TextField
          control={control}
          name={`experience.${index}.location`}
          label="Location"
          placeholder="Remote"
          className="sm:col-span-2"
        />
        <TextField
          control={control}
          name={`experience.${index}.startDate`}
          label="Start"
          placeholder={DATE_PLACEHOLDER}
        />
        <TextField
          control={control}
          name={`experience.${index}.endDate`}
          label="End"
          placeholder={DATE_PLACEHOLDER}
          description="Leave empty while you work here."
        />
        <CheckboxField
          control={control}
          name={`experience.${index}.current`}
          label="I work here now"
          className="sm:col-span-2"
        />
        <TextField
          control={control}
          name={`experience.${index}.summary`}
          label="Summary"
          multiline
          rows={2}
          className="sm:col-span-2"
        />
      </FieldGroup>
      <HighlightsField
        control={control}
        name={`experience.${index}.highlights`}
      />
      <TagsField
        control={control}
        name={`experience.${index}.technologies`}
        label="Technologies"
        placeholder="Type and press Enter"
      />
    </CollapsibleItem>
  );
}

function RoleSummary({
  control,
  index,
}: {
  control: ProfileControl;
  index: number;
}) {
  const role = useWatch({ control, name: `experience.${index}` });
  return (
    <ItemSummary
      tile={role.company || role.title}
      title={role.title || "New role"}
      subtitle={[
        role.company,
        role.location,
        dateRange(role.startDate, role.endDate, role.current),
      ]
        .filter(Boolean)
        .join(" · ")}
      meta={count(role.highlights.length, "bullet")}
    />
  );
}

export function ProjectsSection({ control }: { control: ProfileControl }) {
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "projects",
    keyName: "rhfKey",
  });
  const [added, setAdded] = useState<string | null>(null);

  return (
    <FormSection
      id="projects"
      title="Projects"
      meta={
        fields.length > 0 ? (
          <BulletsMeta control={control} list="projects" noun="project" />
        ) : undefined
      }
      description="Personal, open-source and academic projects."
      addLabel="Add project"
      onAdd={() => {
        const id = newFactId("proj");
        setAdded(id);
        append({
          id,
          name: "",
          role: "",
          url: "",
          startDate: "",
          endDate: "",
          summary: "",
          highlights: [],
          technologies: [],
        });
      }}
      flush
    >
      {fields.length === 0 && (
        <EmptyList className={FLUSH_EMPTY}>No projects yet.</EmptyList>
      )}
      {fields.map((field, index) => (
        <ProjectItem
          key={field.rhfKey}
          control={control}
          index={index}
          count={fields.length}
          onMove={move}
          onRemove={remove}
          defaultOpen={field.id === added}
        />
      ))}
    </FormSection>
  );
}

function ProjectItem({
  control,
  index,
  count: total,
  onMove,
  onRemove,
  defaultOpen,
}: EntryProps) {
  const name = useWatch({ control, name: `projects.${index}.name` });
  const invalid = useEntryInvalid(control, "projects", index);

  return (
    <CollapsibleItem
      summary={<ProjectSummary control={control} index={index} />}
      label={name || `Project ${index + 1}`}
      defaultOpen={defaultOpen}
      invalid={invalid}
      index={index}
      count={total}
      onMove={onMove}
      onRemove={onRemove}
    >
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={control}
          name={`projects.${index}.name`}
          label="Name"
        />
        <TextField
          control={control}
          name={`projects.${index}.role`}
          label="Your role"
          placeholder="Maintainer"
        />
        <TextField
          control={control}
          name={`projects.${index}.url`}
          label="Link"
          type="url"
          placeholder="https://"
          className="sm:col-span-2"
        />
        <TextField
          control={control}
          name={`projects.${index}.startDate`}
          label="Start"
          placeholder={DATE_PLACEHOLDER}
        />
        <TextField
          control={control}
          name={`projects.${index}.endDate`}
          label="End"
          placeholder={DATE_PLACEHOLDER}
        />
        <TextField
          control={control}
          name={`projects.${index}.summary`}
          label="Summary"
          multiline
          rows={2}
          className="sm:col-span-2"
        />
      </FieldGroup>
      <HighlightsField
        control={control}
        name={`projects.${index}.highlights`}
      />
      <TagsField
        control={control}
        name={`projects.${index}.technologies`}
        label="Technologies"
        placeholder="Type and press Enter"
      />
    </CollapsibleItem>
  );
}

function ProjectSummary({
  control,
  index,
}: {
  control: ProfileControl;
  index: number;
}) {
  const project = useWatch({ control, name: `projects.${index}` });
  return (
    <ItemSummary
      tile={project.name}
      title={project.name || "New project"}
      subtitle={[project.role, dateRange(project.startDate, project.endDate)]
        .filter(Boolean)
        .join(" · ")}
      meta={count(project.highlights.length, "bullet")}
    />
  );
}

function HighlightsField({
  control,
  name,
}: {
  control: ProfileControl;
  name: `experience.${number}.highlights` | `projects.${number}.highlights`;
}) {
  const { fields, append, remove, move } = useFieldArray({
    control,
    name,
    keyName: "rhfKey",
  });

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Bullets</legend>
      {fields.length === 0 && <EmptyList>No bullets.</EmptyList>}
      {fields.map((field, index) => (
        <div key={field.rhfKey} className="flex items-start gap-2">
          <TextField
            control={control}
            name={`${name}.${index}.text`}
            label={`Bullet ${index + 1}`}
            hideLabel
            multiline
            rows={1}
            inputClassName="min-h-9"
          />
          <ItemButtons
            index={index}
            count={fields.length}
            onMove={move}
            onRemove={remove}
            label={`bullet ${index + 1}`}
            removeLabel={`Remove bullet ${index + 1}`}
          />
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => append({ id: newFactId("hl"), text: "" })}
        >
          <PlusIcon data-icon="inline-start" />
          Add bullet
        </Button>
      </div>
    </fieldset>
  );
}

export function SkillsSection({ control }: { control: ProfileControl }) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "skills",
    keyName: "rhfKey",
  });
  const skills = useWatch({ control, name: "skills" });

  return (
    <FormSection
      id="skills"
      title="Skills"
      meta={fields.length > 0 ? count(fields.length, "skill") : undefined}
      description="One skill per row. The category groups them on your CV."
      addLabel="Add skill"
      onAdd={() =>
        append({
          id: newFactId("skill"),
          name: "",
          // New skills start in the last row's category.
          category: skills.at(-1)?.category ?? "",
        })
      }
    >
      {fields.length === 0 && <EmptyList>No skills yet.</EmptyList>}
      {fields.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-2 gap-y-2">
          <span className="text-sm font-medium" aria-hidden>
            Skill
          </span>
          <span className="text-sm font-medium" aria-hidden>
            Category
          </span>
          <span />
          {fields.map((field, index) => (
            <SkillRow
              key={field.rhfKey}
              control={control}
              index={index}
              onRemove={remove}
            />
          ))}
        </div>
      )}
    </FormSection>
  );
}

function SkillRow({
  control,
  index,
  onRemove,
}: {
  control: ProfileControl;
  index: number;
  onRemove: (index: number) => void;
}) {
  const name = useWatch({ control, name: `skills.${index}.name` });
  const label = name || `skill ${index + 1}`;
  return (
    <>
      <TextField
        control={control}
        name={`skills.${index}.name`}
        label={`Skill ${index + 1}`}
        hideLabel
      />
      <TextField
        control={control}
        name={`skills.${index}.category`}
        label={`Category of ${label}`}
        hideLabel
      />
      <ItemButtons
        index={index}
        count={1}
        onRemove={onRemove}
        label={label}
        removeLabel={`Remove ${label}`}
      />
    </>
  );
}

export function EducationSection({ control }: { control: ProfileControl }) {
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "education",
    keyName: "rhfKey",
  });
  const [added, setAdded] = useState<string | null>(null);

  return (
    <FormSection
      id="education"
      title="Education"
      addLabel="Add education"
      onAdd={() => {
        const id = newFactId("edu");
        setAdded(id);
        append({
          id,
          institution: "",
          degree: "",
          field: "",
          startDate: "",
          endDate: "",
          details: "",
        });
      }}
      flush
    >
      {fields.length === 0 && (
        <EmptyList className={FLUSH_EMPTY}>No education yet.</EmptyList>
      )}
      {fields.map((field, index) => (
        <EducationItem
          key={field.rhfKey}
          control={control}
          index={index}
          count={fields.length}
          onMove={move}
          onRemove={remove}
          defaultOpen={field.id === added}
        />
      ))}
    </FormSection>
  );
}

function EducationItem({
  control,
  index,
  count: total,
  onMove,
  onRemove,
  defaultOpen,
}: EntryProps) {
  const invalid = useEntryInvalid(control, "education", index);
  return (
    <CollapsibleItem
      summary={<EducationSummary control={control} index={index} />}
      label={`education ${index + 1}`}
      defaultOpen={defaultOpen}
      invalid={invalid}
      index={index}
      count={total}
      onMove={onMove}
      onRemove={onRemove}
    >
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={control}
          name={`education.${index}.institution`}
          label="School or university"
          className="sm:col-span-2"
        />
        <TextField
          control={control}
          name={`education.${index}.degree`}
          label="Degree"
          placeholder="BSc"
        />
        <TextField
          control={control}
          name={`education.${index}.field`}
          label="Field of study"
        />
        <TextField
          control={control}
          name={`education.${index}.startDate`}
          label="Start"
          placeholder={DATE_PLACEHOLDER}
        />
        <TextField
          control={control}
          name={`education.${index}.endDate`}
          label="End"
          placeholder={DATE_PLACEHOLDER}
        />
        <TextField
          control={control}
          name={`education.${index}.details`}
          label="Details"
          multiline
          rows={2}
          className="sm:col-span-2"
        />
      </FieldGroup>
    </CollapsibleItem>
  );
}

function EducationSummary({
  control,
  index,
}: {
  control: ProfileControl;
  index: number;
}) {
  const school = useWatch({ control, name: `education.${index}` });
  return (
    <ItemSummary
      tile={school.institution}
      title={school.institution || "New school"}
      subtitle={[
        [school.degree, school.field].filter(Boolean).join(" in "),
        dateRange(school.startDate, school.endDate),
      ]
        .filter(Boolean)
        .join(" · ")}
    />
  );
}

export function CertificationsSection({ control }: { control: ProfileControl }) {
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "certifications",
    keyName: "rhfKey",
  });
  const [added, setAdded] = useState<string | null>(null);

  return (
    <FormSection
      id="certifications"
      title="Certifications"
      addLabel="Add certification"
      onAdd={() => {
        const id = newFactId("cert");
        setAdded(id);
        append({ id, name: "", issuer: "", date: "", url: "" });
      }}
      flush
    >
      {fields.length === 0 && (
        <EmptyList className={FLUSH_EMPTY}>No certifications.</EmptyList>
      )}
      {fields.map((field, index) => (
        <CertificationItem
          key={field.rhfKey}
          control={control}
          index={index}
          count={fields.length}
          onMove={move}
          onRemove={remove}
          defaultOpen={field.id === added}
        />
      ))}
    </FormSection>
  );
}

function CertificationItem({
  control,
  index,
  count: total,
  onMove,
  onRemove,
  defaultOpen,
}: EntryProps) {
  const invalid = useEntryInvalid(control, "certifications", index);
  return (
    <CollapsibleItem
      summary={<CertificationSummary control={control} index={index} />}
      label={`certification ${index + 1}`}
      defaultOpen={defaultOpen}
      invalid={invalid}
      index={index}
      count={total}
      onMove={onMove}
      onRemove={onRemove}
    >
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={control}
          name={`certifications.${index}.name`}
          label="Name"
        />
        <TextField
          control={control}
          name={`certifications.${index}.issuer`}
          label="Issuer"
        />
        <TextField
          control={control}
          name={`certifications.${index}.date`}
          label="Date"
          placeholder={DATE_PLACEHOLDER}
        />
        <TextField
          control={control}
          name={`certifications.${index}.url`}
          label="Link"
          type="url"
          placeholder="https://"
        />
      </FieldGroup>
    </CollapsibleItem>
  );
}

function CertificationSummary({
  control,
  index,
}: {
  control: ProfileControl;
  index: number;
}) {
  const certification = useWatch({
    control,
    name: `certifications.${index}`,
  });
  return (
    <ItemSummary
      tile={certification.issuer || certification.name}
      title={certification.name || "New certification"}
      subtitle={[certification.issuer, formatMonth(certification.date)]
        .filter(Boolean)
        .join(" · ")}
    />
  );
}

export function LanguagesSection({ control }: { control: ProfileControl }) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "languages",
    keyName: "rhfKey",
  });

  return (
    <FormSection
      id="languages"
      title="Languages"
      description="Spoken languages and your level."
      addLabel="Add language"
      onAdd={() => append({ id: newFactId("lang"), name: "", level: "" })}
    >
      {fields.length === 0 && <EmptyList>No languages yet.</EmptyList>}
      {fields.map((field, index) => (
        <div key={field.rhfKey} className="flex items-start gap-2">
          <TextField
            control={control}
            name={`languages.${index}.name`}
            label={`Language ${index + 1}`}
            hideLabel
            placeholder="Language"
          />
          <TextField
            control={control}
            name={`languages.${index}.level`}
            label={`Level of language ${index + 1}`}
            hideLabel
            placeholder="Level, such as C1"
          />
          <ItemButtons
            index={index}
            count={1}
            onRemove={remove}
            label={`language ${index + 1}`}
            removeLabel={`Remove language ${index + 1}`}
          />
        </div>
      ))}
    </FormSection>
  );
}

export function LinksSection({ control }: { control: ProfileControl }) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "links",
    keyName: "rhfKey",
  });

  return (
    <FormSection
      id="links"
      title="Links"
      description="The links on your CV, such as GitHub or a portfolio. A LinkedIn, GitHub or portfolio saved in your standard answers is used instead of the one here."
      addLabel="Add link"
      onAdd={() => append({ id: newFactId("link"), label: "", url: "" })}
    >
      {fields.length === 0 && <EmptyList>No links yet.</EmptyList>}
      {fields.map((field, index) => (
        <div key={field.rhfKey} className="flex items-start gap-2">
          <TextField
            control={control}
            name={`links.${index}.label`}
            label={`Link ${index + 1} name`}
            hideLabel
            placeholder="GitHub"
            className="max-w-48"
          />
          <TextField
            control={control}
            name={`links.${index}.url`}
            label={`Link ${index + 1} URL`}
            hideLabel
            type="url"
            placeholder="https://"
          />
          <ItemButtons
            index={index}
            count={1}
            onRemove={remove}
            label={`link ${index + 1}`}
            removeLabel={`Remove link ${index + 1}`}
          />
        </div>
      ))}
    </FormSection>
  );
}
