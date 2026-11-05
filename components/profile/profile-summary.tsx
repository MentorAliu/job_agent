import { PencilIcon } from "lucide-react";
import Link from "next/link";
import { useId } from "react";

import { CompanyTile } from "@/components/jobs/company-tile";
import { SENIORITY_LABELS } from "@/components/jobs/labels";
import { buttonVariants } from "@/components/ui/button";
import type {
  Answers,
  MasterProfile,
  Preferences,
} from "@/lib/schemas/profile";
import { cn } from "@/lib/utils";

import { count, dateRange } from "./format";

// The profile as a page to read. Each part links to the form that edits it,
// for the rare correction; a new CV replaces the whole profile by itself.

function Card({
  title,
  editHref,
  editLabel,
  children,
}: {
  title: string;
  editHref: string;
  /** What the edit link names for a screen reader, such as "your experience". */
  editLabel: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="text-[0.9375rem] font-semibold">
          {title}
        </h2>
        <Link
          href={editHref}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "text-muted-foreground",
          )}
        >
          <PencilIcon aria-hidden data-icon="inline-start" />
          Edit<span className="sr-only"> {editLabel}</span>
        </Link>
      </div>
      {children}
    </section>
  );
}

function Chips({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const or = (value: string, fallback = "Not given") => value.trim() || fallback;

/** Who the owner is, as the CV says. */
export function AboutCard({ profile }: { profile: MasterProfile }) {
  const { basics } = profile;
  return (
    <Card title="About you" editHref="/profile/edit#basics" editLabel="basics">
      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold tracking-tight">{basics.name}</p>
        {basics.headline ? (
          <p className="text-sm text-muted-foreground">{basics.headline}</p>
        ) : null}
      </div>
      {basics.summary ? (
        <p className="max-w-prose text-sm text-pretty">{basics.summary}</p>
      ) : null}
      <Facts
        rows={[
          ["Location", or(basics.location)],
          ["Email", or(basics.email)],
          [
            "Links",
            profile.links.length > 0
              ? profile.links.map((link) => link.label).join(", ")
              : "None",
          ],
        ]}
      />
    </Card>
  );
}

export function ExperienceCard({ profile }: { profile: MasterProfile }) {
  return (
    <Card
      title="Experience"
      editHref="/profile/edit#experience"
      editLabel="your experience"
    >
      {profile.experience.length === 0 ? (
        <p className="text-sm text-muted-foreground">No roles yet.</p>
      ) : (
        <ul className="flex flex-col">
          {profile.experience.map((role) => (
            <li
              key={role.id}
              className="flex items-center gap-3 border-t py-2.5 first:border-t-0 first:pt-0 last:pb-0"
            >
              <CompanyTile
                company={role.company}
                className="size-9 rounded-lg text-sm"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold">
                  {role.title}
                </span>
                <span className="truncate text-[0.8125rem] text-muted-foreground">
                  {role.company} ·{" "}
                  {dateRange(role.startDate, role.endDate, role.current)}
                </span>
              </span>
              <span className="text-xs whitespace-nowrap text-muted-foreground max-sm:hidden">
                {count(role.highlights.length, "bullet")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function SkillsCard({ profile }: { profile: MasterProfile }) {
  const more = [
    count(profile.projects.length, "project"),
    count(profile.education.length, "school"),
    count(profile.certifications.length, "certification"),
    count(profile.languages.length, "language"),
  ].join(" · ");
  return (
    <Card
      title="Skills and more"
      editHref="/profile/edit#skills"
      editLabel="your skills"
    >
      <Chips
        items={profile.skills.map((skill) => skill.name)}
        empty="No skills yet."
      />
      <p className="text-[0.8125rem] text-muted-foreground">{more}</p>
    </Card>
  );
}

function salaryFloor({ salaryFloor }: Preferences): string {
  if (salaryFloor.amount === null) return "None";
  const amount = new Intl.NumberFormat("en").format(salaryFloor.amount);
  return `${salaryFloor.currency} ${amount} a ${salaryFloor.period}`;
}

/** What the searches look for. */
export function PreferencesCard({ preferences }: { preferences: Preferences }) {
  return (
    <Card
      title="What the searches look for"
      editHref="/profile/preferences"
      editLabel="your job preferences"
    >
      <Facts
        rows={[
          ["Work from", preferences.countries.join(", ")],
          ["Time zones", preferences.timeZones.join(", ")],
          ["Remote only", preferences.remoteOnly ? "Yes" : "No"],
          [
            "Seniority",
            preferences.seniority.length > 0
              ? preferences.seniority
                  .map((level) => SENIORITY_LABELS[level])
                  .join(", ")
              : "Any",
          ],
          ["Lowest pay", salaryFloor(preferences)],
          [
            "Left out",
            preferences.excludedCompanies.length > 0
              ? count(
                  preferences.excludedCompanies.length,
                  "company",
                  "companies",
                )
              : "None",
          ],
        ]}
      />
      <Chips items={preferences.stack} empty="No stack given: any stack." />
    </Card>
  );
}

/** The answers every application form asks for. */
export function AnswersCard({ answers }: { answers: Answers }) {
  const links = [
    answers.links.linkedin ? "LinkedIn" : null,
    answers.links.github ? "GitHub" : null,
    answers.links.portfolio ? "Portfolio" : null,
  ].filter(Boolean);
  return (
    <Card
      title="Standard answers"
      editHref="/profile/answers"
      editLabel="your standard answers"
    >
      <Facts
        rows={[
          ["Notice period", or(answers.noticePeriod)],
          ["Work authorization", or(answers.workAuthorization)],
          ["Links", links.length > 0 ? links.join(", ") : "None"],
          [
            "Other answers",
            answers.extra.length > 0
              ? count(answers.extra.length, "question")
              : "None yet",
          ],
        ]}
      />
    </Card>
  );
}
