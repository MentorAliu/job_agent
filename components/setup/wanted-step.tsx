"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { saveWantedAction } from "@/app/setup/actions";
import { SENIORITY_LABELS } from "@/components/jobs/labels";
import {
  useBrowserTimeZone,
  useTimeZoneNames,
} from "@/components/time-zone-select";
import { Button } from "@/components/ui/button";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import { Spinner } from "@/components/ui/spinner";
import { callAction } from "@/lib/call-action";
import type { SetupState } from "@/lib/dal/setup";
import {
  SENIORITY_LEVELS,
  WANTED_FOCUS,
  type WantedFocus,
} from "@/lib/schemas/profile";
import { wantedAnswersSchema, type WantedAnswers } from "@/lib/schemas/setup";
import { answerList, choicesFor } from "@/lib/setup/prefill";
import { setupKey } from "@/lib/setup/queries";

import { StepCard } from "./step-card";

type Question = keyof WantedAnswers;

/** The questions, in the order they're asked. */
const QUESTIONS: Question[] = [
  "roleFocus",
  "seniority",
  "countries",
  "timeZones",
  "stack",
];

const FOCUS_CHOICES: Record<WantedFocus, { label: string; about: string }> = {
  any: { label: "Any kind", about: "No kind of role goes first." },
  frontend: {
    label: "Frontend",
    about: "React, Angular, Vue and the like, whichever framework.",
  },
  fullstack: { label: "Full-stack", about: "Frontend and backend together." },
  backend: { label: "Backend", about: "APIs, services and data." },
  mobile: { label: "Mobile", about: "iOS, Android, React Native, Flutter." },
};

const TIME_ZONE_LIST_ID = "setup-time-zones";

/** What the questions' inputs hold, as answers to check. */
function readAnswers(data: FormData) {
  const focus = data.get("roleFocus");
  return {
    roleFocus: typeof focus === "string" ? focus : "any",
    seniority: answerList(data.getAll("seniority")),
    countries: answerList(data.getAll("countries")),
    timeZones: answerList(data.getAll("timeZones")),
    stack: answerList(data.getAll("stack")),
  };
}

/** Error messages by question, from paths such as `timeZones.0`. */
function errorsByQuestion(
  issues: { path: string; message: string }[],
): Partial<Record<Question, string>> {
  const errors: Partial<Record<Question, string>> = {};
  for (const { path, message } of issues) {
    const question = path.split(".")[0] as Question;
    if (QUESTIONS.includes(question) && !errors[question]) {
      errors[question] = message;
    }
  }
  return errors;
}

/**
 * Step 4: what the owner is looking for, one question at a time, with the
 * answers the CV suggests already ticked, so most questions need only Next.
 * Saving puts them in the job preferences.
 */
export function WantedStep({
  wanted,
  onContinue,
}: {
  wanted: SetupState["wanted"];
  onContinue: () => void;
}) {
  const queryClient = useQueryClient();
  // The answers when the step opened, so a refresh doesn't move ticks
  // under the owner's hand.
  const [{ answers, suggested }] = useState(wanted);
  const [question, setQuestion] = useState<string>(QUESTIONS[0]);
  const [errors, setErrors] = useState<Partial<Record<Question, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const browserZone = useBrowserTimeZone();
  const zoneNames = useTimeZoneNames();

  const countries = choicesFor(answers.countries, suggested.countries);
  const zones = choicesFor(answers.timeZones, [
    ...suggested.timeZones,
    ...(browserZone && browserZone !== "UTC" ? [browserZone] : []),
  ]);
  const stack = choicesFor(answers.stack, suggested.stack);
  // With nothing picked yet, the browser's own zone is a fair first answer.
  const zoneChecked = (zone: string) =>
    answers.timeZones.length > 0
      ? answers.timeZones.includes(zone)
      : zone === browserZone;

  function fail(found: Partial<Record<Question, string>>) {
    setErrors(found);
    const first = QUESTIONS.find((name) => found[name]);
    if (first) setQuestion(first);
  }

  function clearError(name: Question) {
    if (!errors[name]) return;
    setErrors((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setFormError(null);
    const parsed = wantedAnswersSchema.safeParse(
      readAnswers(new FormData(event.currentTarget)),
    );
    if (!parsed.success) {
      fail(
        errorsByQuestion(
          parsed.error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        ),
      );
      return;
    }
    startSaving(async () => {
      const result = await callAction(() => saveWantedAction(parsed.data));
      if (!result.ok) {
        const found = errorsByQuestion(
          Object.entries(result.errors.fieldErrors).map(([path, messages]) => ({
            path,
            message: messages[0] ?? "Check this answer.",
          })),
        );
        if (Object.keys(found).length > 0) fail(found);
        setFormError(result.errors.formErrors[0] ?? null);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: setupKey });
      onContinue();
    });
  }

  const item = (name: Question) => ({
    name,
    invalid: Boolean(errors[name]),
    onChange: () => clearError(name),
  });
  const error = (name: Question, fallback?: string) => (
    <QuestionnaireError>{errors[name] ?? fallback}</QuestionnaireError>
  );

  return (
    <StepCard
      title="What you're looking for"
      description={
        wanted.saved
          ? "Saved. Change anything and save again, or go on."
          : "Five quick questions, answered from your CV where it could. The search uses them to find and score roles. Salary floor and companies to skip are optional, on Profile, Preferences, any time."
      }
      footer={
        wanted.saved ? (
          <>
            <span />
            <Button type="button" variant="outline" onClick={onContinue}>
              Continue without changes
              <ArrowRightIcon aria-hidden data-icon="inline-end" />
            </Button>
          </>
        ) : undefined
      }
    >
      <Questionnaire
        item={question}
        onItemChange={setQuestion}
        onSubmit={submit}
        aria-label="What you're looking for"
      >
        <QuestionnaireProgress />

        <QuestionnaireItem {...item("roleFocus")} required>
          <QuestionnaireTitle>
            What kind of role do you want most?
          </QuestionnaireTitle>
          <QuestionnaireDescription>
            Those roles come first in searches, scores and kits.
          </QuestionnaireDescription>
          <QuestionnaireChoices>
            {WANTED_FOCUS.map((focus) => (
              <QuestionnaireChoice
                key={focus}
                value={focus}
                defaultChecked={answers.roleFocus === focus}
              >
                {FOCUS_CHOICES[focus].label}
                <QuestionnaireChoiceDescription>
                  {FOCUS_CHOICES[focus].about}
                </QuestionnaireChoiceDescription>
              </QuestionnaireChoice>
            ))}
          </QuestionnaireChoices>
          {error("roleFocus")}
        </QuestionnaireItem>

        <QuestionnaireItem {...item("seniority")} multiple>
          <QuestionnaireTitle>Which levels?</QuestionnaireTitle>
          <QuestionnaireDescription>
            Pick the levels you&apos;d take, or choose Any level to see them
            all.
          </QuestionnaireDescription>
          <QuestionnaireChoices className="sm:grid-cols-2">
            {SENIORITY_LEVELS.map((level) => (
              <QuestionnaireChoice
                key={level}
                value={level}
                defaultChecked={answers.seniority.includes(level)}
              >
                {level === "principal"
                  ? "Principal or staff"
                  : SENIORITY_LABELS[level]}
              </QuestionnaireChoice>
            ))}
          </QuestionnaireChoices>
          {error("seniority", "Pick at least one level, or press Any level.")}
        </QuestionnaireItem>

        <QuestionnaireItem {...item("countries")} multiple required>
          <QuestionnaireTitle>
            Which countries can you work from?
          </QuestionnaireTitle>
          <QuestionnaireDescription>
            Where you live or can legally work. Remote roles open only to other
            countries are skipped.
          </QuestionnaireDescription>
          {countries.length > 0 ? (
            <QuestionnaireChoices className="sm:grid-cols-2">
              {countries.map((country) => (
                <QuestionnaireChoice
                  key={country}
                  value={country}
                  defaultChecked={answers.countries.includes(country)}
                >
                  {country}
                </QuestionnaireChoice>
              ))}
            </QuestionnaireChoices>
          ) : null}
          <QuestionnaireInput
            placeholder={
              countries.length > 0
                ? "Add more, separated by commas"
                : "Portugal, Spain"
            }
            autoComplete="country-name"
            aria-label="Countries"
          />
          {error("countries")}
        </QuestionnaireItem>

        <QuestionnaireItem {...item("timeZones")} multiple required>
          <QuestionnaireTitle>
            Which time zones can you work in?
          </QuestionnaireTitle>
          <QuestionnaireDescription>
            Time zone names such as Europe/Lisbon. Roles that need hours far
            outside them are skipped.
          </QuestionnaireDescription>
          {zones.length > 0 ? (
            <QuestionnaireChoices className="sm:grid-cols-2">
              {zones.map((zone) => (
                <QuestionnaireChoice
                  key={zone}
                  value={zone}
                  defaultChecked={zoneChecked(zone)}
                >
                  {zone.replaceAll("_", " ")}
                  {zone === browserZone ? (
                    <QuestionnaireChoiceDescription>
                      This device&apos;s time zone
                    </QuestionnaireChoiceDescription>
                  ) : null}
                </QuestionnaireChoice>
              ))}
            </QuestionnaireChoices>
          ) : null}
          <QuestionnaireInput
            placeholder="Add more, such as Europe/Berlin"
            list={TIME_ZONE_LIST_ID}
            aria-label="Time zones"
          />
          <datalist id={TIME_ZONE_LIST_ID}>
            {zoneNames.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
          {error("timeZones")}
        </QuestionnaireItem>

        <QuestionnaireItem {...item("stack")} multiple required>
          <QuestionnaireTitle>
            What do you want to work with?
          </QuestionnaireTitle>
          <QuestionnaireDescription>
            {stack.length > 0
              ? "Ticked from your CV's skills. Untick what you'd rather not use, and add more."
              : "Languages, frameworks and tools, separated by commas."}
          </QuestionnaireDescription>
          {stack.length > 0 ? (
            <QuestionnaireChoices className="grid-cols-2 sm:grid-cols-3">
              {stack.map((skill) => (
                <QuestionnaireChoice
                  key={skill}
                  value={skill}
                  defaultChecked={answers.stack.includes(skill)}
                >
                  {skill}
                </QuestionnaireChoice>
              ))}
            </QuestionnaireChoices>
          ) : null}
          <QuestionnaireInput
            placeholder={
              stack.length > 0
                ? "Add more, separated by commas"
                : "TypeScript, React, Node.js"
            }
            aria-label="Stack"
          />
          {error("stack")}
        </QuestionnaireItem>

        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}
        <QuestionnaireActions>
          <QuestionnairePrevious>Back</QuestionnairePrevious>
          <QuestionnaireSkip>
            {question === "seniority" ? "Any level" : "Skip"}
          </QuestionnaireSkip>
          <QuestionnaireNext />
          <QuestionnaireSubmit disabled={saving}>
            {saving ? <Spinner aria-hidden data-icon="inline-start" /> : null}
            Save and continue
          </QuestionnaireSubmit>
        </QuestionnaireActions>
      </Questionnaire>
    </StepCard>
  );
}
