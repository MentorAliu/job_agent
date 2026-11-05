"use client";

import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { useState, useTransition } from "react";

import {
  removeClaudeApiKeyAction,
  removeCodexLoginAction,
  removeOpenAiKeyAction,
  saveClaudeApiKeyAction,
  saveCodexLoginAction,
  saveOpenAiKeyAction,
} from "@/app/(app)/settings/actions";
import { LocalDate } from "@/components/jobs/local-date";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { callAction } from "@/lib/call-action";
import type { EngineView, SettingsView } from "@/lib/dal/settings";
import type { ActionResult } from "@/lib/schemas/action";
import {
  ENGINE_NAMES,
  isCliEngine,
  type AgentEngine,
  type OtherEngine,
} from "@/lib/schemas/settings";

// How to sign each engine in, for Settings and setup: the steps, the form
// for a sign-in or key the owner pastes, and how the engine's last steps
// went.

export type Fallback = SettingsView["fallback"];
export type Runner = SettingsView["runner"];

/** Called after a sign-in or key is saved or removed, with whether it was saved. */
export type OnSignInChange = (saved: boolean) => void;

/** Where another engine's steps run, and what happens when one can't. */
export function FallbackNote({
  engine,
  runner,
  fallback,
}: {
  engine: OtherEngine;
  runner: Runner;
  fallback: Fallback;
}) {
  const name = ENGINE_NAMES[engine];
  const where = !isCliEngine(engine)
    ? "Each step calls OpenAI straight from the app, and OpenAI doesn't keep the answers."
    : runner === "vercel-sandbox"
      ? `Each step starts a short-lived Vercel Sandbox that can reach only ${name}'s servers.`
      : `Each step runs ${name} where the app runs, in a new empty folder, with none of the app's keys and no tools but web search.`;
  const example = isCliEngine(engine)
    ? "once the plan's limit is reached"
    : "once your OpenAI credit runs out";
  return (
    <p className="text-[0.8125rem] text-muted-foreground">
      {where}{" "}
      {fallback ? (
        <>
          A step {name} can&apos;t run, for example {example}, runs on the{" "}
          {ENGINE_NAMES[fallback]} with your key, within the monthly budget. Set
          the budget to $0 to never pay for API calls.
        </>
      ) : (
        <>
          There&apos;s no API key to fall back on, so a step {name} can&apos;t
          run, for example {example}, stops and says why. That&apos;s fine: an
          API key is optional.
        </>
      )}
    </p>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return (
    <ol className="list-decimal pl-5 text-[0.8125rem] text-muted-foreground [&>li]:mt-1.5">
      {children}
    </ol>
  );
}

function Command({ children }: { children: string }) {
  return (
    <code className="mt-1 block rounded-md border bg-muted/60 px-2 py-1.5 font-mono text-xs break-all text-foreground select-all">
      {children}
    </code>
  );
}

/** When the engine last answered, and why a step last ran on the API. */
function EngineHistory({
  engine,
  view,
  fallback,
}: {
  engine: OtherEngine;
  view: EngineView;
  fallback: Fallback;
}) {
  if (!view.lastOkAt && !view.issue) return null;
  return (
    <div className="flex flex-col gap-1.5 text-[0.8125rem]">
      {view.lastOkAt ? (
        <p className="flex items-start gap-1.5 text-muted-foreground">
          <CircleCheckIcon
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-success-ink"
          />
          <span>
            Last step on {ENGINE_NAMES[engine]}:{" "}
            <LocalDate iso={view.lastOkAt} withTime />
          </span>
        </p>
      ) : null}
      {view.issue && view.issueAt ? (
        <p className="flex items-start gap-1.5">
          <TriangleAlertIcon
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-warning-ink"
          />
          <span>
            <LocalDate iso={view.issueAt} withTime />: {view.issue}{" "}
            {fallback
              ? `Steps like it run on the ${ENGINE_NAMES[fallback]}.`
              : "Steps like it stop until it can run them."}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function ClaudeCodeSetup({
  view,
  runner,
  fallback,
  history,
}: {
  view: EngineView;
  runner: Runner;
  fallback: Fallback;
  history: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {view.signedIn ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          Claude Code signs in with CLAUDE_CODE_OAUTH_TOKEN from the app&apos;s
          environment. Its token lasts a year; to replace it, do the steps below
          again.
        </p>
      ) : (
        <p className="text-[0.8125rem] font-medium">
          Sign Claude Code in once, from your computer:
        </p>
      )}
      <Steps>
        <li>
          In a terminal, run this and sign in with your Claude account. It
          prints a token.
          <Command>claude setup-token</Command>
        </li>
        {runner === "vercel-sandbox" ? (
          <>
            <li>
              In your Vercel project, open Settings, then Environment Variables.
              Add CLAUDE_CODE_OAUTH_TOKEN with that token, for Production,
              marked Sensitive.
            </li>
            <li>Redeploy production, so the app reads it.</li>
          </>
        ) : (
          <>
            <li>
              Put it in the app&apos;s .env file:
              <Command>CLAUDE_CODE_OAUTH_TOKEN=the-token</Command>
            </li>
            <li>
              Restart the app, so it reads it, then come back to this page:
              <Command>docker compose --profile app up -d</Command>
            </li>
          </>
        )}
      </Steps>
      <p className="text-[0.8125rem] text-muted-foreground">
        The token goes in the app&apos;s environment, not on this page, so the
        app never handles your Claude sign-in itself.
      </p>
      {history ? (
        <EngineHistory engine="claude_code" view={view} fallback={fallback} />
      ) : null}
    </div>
  );
}

/**
 * A sign-in the owner pastes once: saved encrypted, never shown again, and
 * removable.
 */
function SecretForm({
  id,
  label,
  placeholder,
  field,
  multiline,
  signedIn,
  save,
  remove,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  /** The action's field name, for its error. */
  field: string;
  multiline: boolean;
  signedIn: boolean;
  save: (value: string) => Promise<ActionResult>;
  remove: () => Promise<ActionResult>;
  onChange?: OnSignInChange;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult>, saving: boolean) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await callAction(action);
      if (!result.ok) {
        setError(
          result.errors.fieldErrors[field]?.[0] ??
            result.errors.formErrors[0] ??
            "Couldn't save.",
        );
        return;
      }
      setValue("");
      setSaved(saving);
      onChange?.(saving);
    });
  }

  const shared = {
    id,
    value,
    placeholder,
    spellCheck: false,
    autoComplete: "off",
    "aria-invalid": error ? true : undefined,
    "aria-describedby": `${id}-description`,
  } as const;
  return (
    <>
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {multiline ? (
          <Textarea
            {...shared}
            onChange={(event) => setValue(event.target.value)}
            className="min-h-20 font-mono text-xs"
          />
        ) : (
          // Plain text, so the browser never offers to save the key as the
          // app's password, or fills the password in here.
          <Input
            {...shared}
            type="text"
            onChange={(event) => setValue(event.target.value)}
            className="font-mono text-xs"
          />
        )}
        <FieldDescription id={`${id}-description`}>
          It works like a password: the app keeps it encrypted and never shows
          it again.
        </FieldDescription>
        {error ? <FieldError>{error}</FieldError> : null}
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || value.trim() === ""}
          onClick={() => run(() => save(value), true)}
        >
          {pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
          {multiline ? "Save sign-in" : "Save key"}
        </Button>
        {signedIn ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run(remove, false)}
          >
            {multiline ? "Remove sign-in" : "Remove key"}
          </Button>
        ) : null}
        <p role="status" aria-live="polite" className="text-[0.8125rem]">
          {saved ? <span className="text-success-ink">Saved.</span> : null}
        </p>
      </div>
    </>
  );
}

function CodexSetup({
  view,
  fallback,
  history,
  onChange,
}: {
  view: EngineView;
  fallback: Fallback;
  history: boolean;
  onChange?: OnSignInChange;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.8125rem] font-medium">
        {view.signedIn && view.loginSavedAt ? (
          <>
            Signed in. Codex&apos;s sign-in was saved{" "}
            <LocalDate iso={view.loginSavedAt} withTime />; the app keeps the
            copy Codex renews.
          </>
        ) : (
          "Sign Codex in once, from your computer:"
        )}
      </p>
      <Steps>
        <li>
          In a terminal (Git Bash on Windows), run this and sign in with your
          ChatGPT account. It keeps a sign-in for the app apart from your own
          Codex, so the two never renew the same one.
          <Command>
            {`mkdir -p ~/.codex-job-agent && CODEX_HOME=~/.codex-job-agent codex -c 'cli_auth_credentials_store="file"' login`}
          </Command>
        </li>
        <li>
          Copy the whole file this prints, and paste it below.
          <Command>cat ~/.codex-job-agent/auth.json</Command>
        </li>
      </Steps>
      <SecretForm
        id="codex-auth-json"
        label="Codex's auth.json"
        placeholder='{"auth_mode": "chatgpt", "tokens": { … } }'
        field="authJson"
        multiline
        signedIn={view.signedIn}
        save={(authJson) => saveCodexLoginAction({ authJson })}
        remove={removeCodexLoginAction}
        onChange={onChange}
      />
      {history ? (
        <EngineHistory engine="codex" view={view} fallback={fallback} />
      ) : null}
    </div>
  );
}

/** The key's state, then how to get one and the form to paste it. */
function ApiKeySetup({
  engine,
  view,
  fallback,
  history,
  onChange,
}: {
  engine: "claude_api" | "openai_api";
  view: EngineView;
  fallback: Fallback;
  history: boolean;
  onChange?: OnSignInChange;
}) {
  const claude = engine === "claude_api";
  const envName = claude ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.8125rem] font-medium">
        {view.fromEnv ? (
          `The app has ${claude ? "a Claude" : "an OpenAI"} API key: ${envName} in its environment. A key saved below takes its place.`
        ) : view.signedIn && view.loginSavedAt ? (
          <>
            Key saved <LocalDate iso={view.loginSavedAt} withTime />. To use
            another one, paste it below.
          </>
        ) : (
          `Add ${claude ? "a Claude" : "an OpenAI"} API key once:`
        )}
      </p>
      <Steps>
        {claude ? (
          <>
            <li>
              On platform.claude.com, open API keys and create a key. A
              workspace of its own keeps the app&apos;s spend apart.
            </li>
            <li>
              Make sure the account has credit, under Billing on the same site.
            </li>
          </>
        ) : (
          <>
            <li>
              On platform.openai.com, open API keys and create a secret key. A
              key for its own project keeps the app&apos;s spend apart.
            </li>
            <li>
              Make sure the account has credit, under Billing on the same site.
            </li>
          </>
        )}
        <li>
          Paste the key below. The app checks it with{" "}
          {claude ? "the Claude API" : "OpenAI"} first.
        </li>
      </Steps>
      <SecretForm
        id={claude ? "claude-api-key" : "openai-api-key"}
        label={claude ? "Claude API key" : "OpenAI API key"}
        placeholder={claude ? "sk-ant-…" : "sk-proj-…"}
        field="apiKey"
        multiline={false}
        signedIn={view.signedIn && !view.fromEnv}
        save={(apiKey) =>
          claude
            ? saveClaudeApiKeyAction({ apiKey })
            : saveOpenAiKeyAction({ apiKey })
        }
        remove={claude ? removeClaudeApiKeyAction : removeOpenAiKeyAction}
        onChange={onChange}
      />
      {history && engine === "openai_api" ? (
        <EngineHistory engine="openai_api" view={view} fallback={fallback} />
      ) : null}
    </div>
  );
}

/**
 * How to sign the engine in, or give the app its key. `history` adds when it
 * last ran a step and why one last fell back, for Settings. `onChange` runs
 * after a pasted sign-in or key is saved or removed.
 */
export function EngineConnect({
  engine,
  engines,
  runner,
  fallback,
  history = true,
  onChange,
}: {
  engine: AgentEngine;
  engines: Record<AgentEngine, EngineView>;
  runner: Runner;
  fallback: Fallback;
  history?: boolean;
  onChange?: OnSignInChange;
}) {
  switch (engine) {
    case "claude_code":
      return (
        <ClaudeCodeSetup
          view={engines.claude_code}
          runner={runner}
          fallback={fallback}
          history={history}
        />
      );
    case "codex":
      return (
        <CodexSetup
          view={engines.codex}
          fallback={fallback}
          history={history}
          onChange={onChange}
        />
      );
    case "claude_api":
    case "openai_api":
      return (
        <ApiKeySetup
          engine={engine}
          view={engines[engine]}
          fallback={fallback}
          history={history}
          onChange={onChange}
        />
      );
  }
}
