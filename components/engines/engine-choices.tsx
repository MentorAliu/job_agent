"use client";

import { CloudIcon, SquareTerminalIcon, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { EngineView } from "@/lib/dal/settings";
import {
  ENGINE_CHOICE_ORDER,
  ENGINE_NAMES,
  type AgentEngine,
} from "@/lib/schemas/settings";

/** What each choice is, and how its steps are paid for. */
export const ENGINE_CHOICES: Record<
  AgentEngine,
  { icon: LucideIcon; about: string; cost: string }
> = {
  claude_code: {
    icon: SquareTerminalIcon,
    about:
      "Anthropic's command-line agent on your Claude Pro or Max plan. Claude Sonnet 5.5 writes kits and CVs; Claude Haiku 5.5 searches and scores.",
    cost: "Uses your plan's limits. $0 against the budget.",
  },
  codex: {
    icon: SquareTerminalIcon,
    about:
      "OpenAI's command-line agent on your ChatGPT plan, with OpenAI's Codex model. Newer here than Claude Code, and tested less.",
    cost: "Uses your plan's Codex limits. $0 against the budget.",
  },
  claude_api: {
    icon: CloudIcon,
    about:
      "Anthropic's API, with your own key. The same Claude models as Claude Code.",
    cost: "Paid per call, within the monthly budget.",
  },
  openai_api: {
    icon: CloudIcon,
    about:
      "OpenAI's API, with your own key. GPT-6.1 Sol writes kits and CVs; GPT-6 Luna searches and scores.",
    cost: "Paid per call, within the monthly budget, at the Claude API's prices.",
  },
};

/**
 * One card per engine, a plan's command-line agent first, each with whether
 * it's signed in. For Settings' form and for setup.
 */
export function EngineChoiceCards({
  name,
  value,
  onValueChange,
  engines,
  disabled,
}: {
  name: string;
  /** The engine picked, or null while none is (setup, before a choice). */
  value: AgentEngine | null;
  onValueChange: (engine: AgentEngine) => void;
  engines: Record<AgentEngine, EngineView>;
  disabled?: boolean;
}) {
  return (
    <RadioGroup
      name={name}
      value={value}
      onValueChange={(next) => onValueChange(next as AgentEngine)}
      disabled={disabled}
      className="grid gap-3 sm:grid-cols-2"
    >
      {ENGINE_CHOICE_ORDER.map((engine) => (
        <ChoiceCard
          key={engine}
          name={name}
          engine={engine}
          view={engines[engine]}
        />
      ))}
    </RadioGroup>
  );
}

function ChoiceCard({
  name,
  engine,
  view,
}: {
  name: string;
  engine: AgentEngine;
  view: EngineView;
}) {
  const { icon: Icon, about, cost } = ENGINE_CHOICES[engine];
  const id = `${name}-${engine}`;
  return (
    <FieldLabel htmlFor={id} className="h-full">
      <Field orientation="horizontal" className="h-full items-start">
        <FieldContent className="gap-2">
          <FieldTitle>
            <Icon aria-hidden className="size-4 text-muted-foreground" />
            {ENGINE_NAMES[engine]}
          </FieldTitle>
          <FieldDescription>{about}</FieldDescription>
          <FieldDescription className="text-foreground">
            {cost}
          </FieldDescription>
          <div>
            <StatusBadge engine={engine} view={view} />
          </div>
        </FieldContent>
        <RadioGroupItem value={engine} id={id} />
      </Field>
    </FieldLabel>
  );
}

function StatusBadge({
  engine,
  view,
}: {
  engine: AgentEngine;
  view: EngineView;
}) {
  const isKey = engine === "claude_api" || engine === "openai_api";
  if (!view.signedIn) {
    return (
      <Badge variant="outline">{isKey ? "No key yet" : "Not signed in"}</Badge>
    );
  }
  return (
    <Badge variant="secondary">
      {!isKey ? "Signed in" : view.fromEnv ? "Key in .env" : "Key saved"}
    </Badge>
  );
}
