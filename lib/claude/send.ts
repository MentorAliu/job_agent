import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages";

import { noteEngineIssue, readOpenAiKey } from "@/lib/pipeline/engine-state";
import {
  ENGINE_NAMES,
  isCliEngine,
  type OtherEngine,
} from "@/lib/schemas/settings";

import { hasClaudeApiKey, withClaudeApiKey } from "./api-key";
import { assertWithinBudget } from "./budget";
import { runCliTasks, type CliOutcome } from "./cli/run";
import { taskFromRequest, type CliReply, type CliTask } from "./cli/task";
import { recordLlmCall, type LlmCallLinks, type StageSetup } from "./llm-call";
import { runOnOpenAi } from "./openai-api";

// Where an agent step goes: first the engine picked in Settings (a
// command-line agent on the owner's plan, or the OpenAI API), then an API
// with the owner's key, within the budget. A step a plan's agent can't run
// goes to the Claude API when the app has its key, else to the OpenAI API
// when it has that key. With neither, it stops and says why.

/** Another engine's answer, checked against the step's schema. */
export type CliAnswer<T> = {
  value: T;
  /** The engine that answered: the one Settings picked, or the OpenAI API. */
  engine: OtherEngine;
  reply: CliReply;
  /** The setup to log the answer with: the model that answered, its prices. */
  setup: StageSetup;
  /**
   * Logs the answer to `llm_call`: $0 when made on the owner's plan, at the
   * stand-in model's prices on the OpenAI API.
   */
  record(links?: LlmCallLinks): Promise<number>;
};

/**
 * Where a step goes when a plan's command-line agent can't answer it and
 * the app has no Claude API key: the OpenAI API, when there's a key for it.
 */
async function openAiFallback(engine: OtherEngine): Promise<boolean> {
  return (
    isCliEngine(engine) &&
    !(await hasClaudeApiKey()) &&
    (await readOpenAiKey()) !== null
  );
}

function runOn(
  engine: OtherEngine,
  setup: StageSetup,
  tasks: CliTask[],
  runId?: string,
): Promise<CliOutcome[]> {
  return engine === "openai_api"
    ? runOnOpenAi(setup, tasks, runId)
    : runCliTasks(engine, tasks);
}

/**
 * Runs tasks on the stage's engine and checks each answer with `parse`: on a
 * command-line agent in one box, on the OpenAI API one after another, each
 * within the budget. Tasks a plan's agent can't answer go to the OpenAI API
 * when that's the only key the app has. An entry is null when its task
 * couldn't run or its answer didn't parse, so the step can use the Claude
 * API for it. Every entry is null when Settings didn't pick another engine.
 */
export async function answersOnCli<T>(
  setup: StageSetup,
  tasks: CliTask[],
  parse: (output: unknown) => T,
  runId?: string,
): Promise<(CliAnswer<T> | null)[]> {
  const { engine } = setup;
  if (!engine || tasks.length === 0) return tasks.map(() => null);

  const answers = await answersOn(engine, setup, tasks, parse, runId);
  const left = answers.flatMap((answer, index) => (answer ? [] : [index]));
  if (left.length > 0 && (await openAiFallback(engine))) {
    const more = await answersOn(
      "openai_api",
      setup,
      left.map((index) => tasks[index]),
      parse,
      runId,
    );
    left.forEach((index, at) => {
      answers[index] = more[at];
    });
  }
  return answers;
}

/** Tasks on one engine, each answer checked with `parse`. */
async function answersOn<T>(
  engine: OtherEngine,
  setup: StageSetup,
  tasks: CliTask[],
  parse: (output: unknown) => T,
  runId?: string,
): Promise<(CliAnswer<T> | null)[]> {
  const outcomes = await runOn(engine, setup, tasks, runId);
  let unusable = 0;
  const answers = outcomes.map((outcome): CliAnswer<T> | null => {
    if (!outcome.ok) return null;
    const { reply } = outcome;
    let value: T;
    try {
      value = parse(reply.output);
    } catch {
      unusable++;
      return null;
    }
    const answerSetup = setupFor(setup, engine, reply);
    return {
      value,
      engine,
      reply,
      setup: answerSetup,
      record: (links = {}) =>
        recordLlmCall(answerSetup, reply.usage, reply.requestId, {
          ...links,
          engine,
        }),
    };
  });
  if (unusable > 0) {
    await noteEngineIssue(
      engine,
      `${unusable === 1 ? "An answer" : `${unusable} answers`} didn't match the step's schema.`,
    );
  }
  return answers;
}

/** One task on the stage's engine; see answersOnCli. */
export async function answerOnCli<T>(
  setup: StageSetup,
  task: CliTask | null,
  parse: (output: unknown) => T,
  runId?: string,
): Promise<CliAnswer<T> | null> {
  if (!task) return null;
  const [answer] = await answersOnCli(setup, [task], parse, runId);
  return answer;
}

/** The stage's setup with the model that answered, and on OpenAI its prices. */
function setupFor(
  setup: StageSetup,
  engine: OtherEngine,
  reply: CliReply,
): StageSetup {
  return engine === "openai_api" && setup.openAi
    ? { ...setup, model: reply.model, price: setup.openAi.price }
    : { ...setup, model: reply.model };
}

/** A response, from the Claude API or another engine, as the steps read it. */
export type Sent = {
  message: Pick<Message, "content" | "stop_reason" | "usage">;
  requestId: string | null;
  /** Logs the response to `llm_call` and returns its cost in USD. */
  record(links?: LlmCallLinks): Promise<number>;
};

type Parseable = { parse?: (content: string) => unknown };

/**
 * Sends a one-shot step's Messages request: first to the stage's other
 * engine when Settings picked one, then, if that can't answer, to the Claude
 * API after checking the budget and that the app has its key. `cliTask`
 * replaces the task made from the request, for a request another engine
 * can't take as it is.
 */
export async function sendRequest({
  setup,
  request,
  estimateUsd,
  runId,
  client,
  cliTask,
}: {
  setup: StageSetup;
  request: MessageCreateParamsNonStreaming;
  estimateUsd: number;
  runId?: string;
  client: Anthropic;
  cliTask?: CliTask | null;
}): Promise<Sent> {
  if (setup.engine) {
    const format = request.output_config?.format as Parseable | undefined;
    const task = cliTask ?? taskFromRequest(request, setup.stage);
    if (!task) {
      await noteEngineIssue(
        setup.engine,
        `${ENGINE_NAMES[setup.engine]} can't read this step's input, such as a PDF with no text.`,
      );
    }
    const answer = await answerOnCli(
      setup,
      task,
      (output) => {
        const text = JSON.stringify(output);
        format?.parse?.(text);
        return text;
      },
      runId,
    );
    if (answer) {
      return {
        message: {
          content: [{ type: "text", text: answer.value, citations: null }],
          stop_reason: "end_turn",
          usage: answer.reply.usage,
        },
        requestId: answer.reply.requestId,
        record: answer.record,
      };
    }
  }

  const api = await withClaudeApiKey(client, setup.engine);
  if (runId) await assertWithinBudget(estimateUsd, runId);
  else await assertWithinBudget(estimateUsd);
  const { data: message, request_id } = await api.messages
    .create(request)
    .withResponse();
  const requestId = request_id ?? null;
  return {
    message,
    requestId,
    record: (links) =>
      links
        ? recordLlmCall(setup, message.usage, requestId, links)
        : recordLlmCall(setup, message.usage, requestId),
  };
}
