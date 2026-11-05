import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { codexArgs, codexPrompt, parseCodexRun } from "./codex";
import { withLocalBox } from "./local-box";
import type { CliTask } from "./task";

// The real Codex CLI, run the way runCodex runs it, against a fake OpenAI
// Responses API on this machine, so no sign-in or network is needed. It
// checks that Codex takes the app's flags, reads the prompt and the schema,
// and writes an answer the app can read. Opt in, with Codex on PATH:
//
//   CODEX_E2E=1 pnpm vitest run lib/claude/cli/codex.e2e.test.ts
//
// A ChatGPT sign-in talks to chatgpt.com instead, which only a real sign-in
// can check.

const ANSWER = { verdict: "open", reason: "The page lists the role." };

const TASK: CliTask = {
  stage: "extract",
  model: "claude-haiku-5-5",
  system: "Read the posting into the schema.",
  prompt: "Senior Frontend Engineer at Northwind. Remote in Europe.",
  schema: {
    type: "object",
    properties: { verdict: { type: "string" }, reason: { type: "string" } },
    required: ["verdict", "reason"],
    additionalProperties: false,
  },
  effort: "low",
};

/** Server-sent events as the Responses API streams them. */
function sse(events: { type: string; [key: string]: unknown }[]): string {
  return events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

let server: Server;
let baseUrl = "";
const requests: { path: string; body: string }[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => {
      requests.push({ path: request.url ?? "", body });
      if (request.method === "POST" && request.url?.endsWith("/responses")) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(
          sse([
            { type: "response.created", response: { id: "resp_1" } },
            {
              type: "response.output_item.done",
              item: {
                type: "message",
                role: "assistant",
                id: "msg_1",
                content: [
                  { type: "output_text", text: JSON.stringify(ANSWER) },
                ],
              },
            },
            {
              type: "response.completed",
              response: {
                id: "resp_1",
                usage: {
                  input_tokens: 1200,
                  input_tokens_details: { cached_tokens: 200 },
                  output_tokens: 40,
                  output_tokens_details: { reasoning_tokens: 0 },
                  total_tokens: 1240,
                },
              },
            },
          ]),
        );
        return;
      }
      // Anything else Codex asks for, such as the model list.
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [], models: [] }));
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => {
  server?.close();
});

describe.skipIf(!process.env.CODEX_E2E)("Codex, for real", () => {
  it("answers a task with the app's flags, and the app reads the answer", async () => {
    const reply = await withLocalBox("codex", 120_000, async (box) => {
      const home = `${box.dir}/codex`;
      const files = {
        prompt: `${box.dir}/prompt.txt`,
        schema: `${box.dir}/schema.json`,
        answer: `${box.dir}/answer.json`,
      };
      await box.writeFiles([
        // An API key sign-in, in the file a ChatGPT sign-in goes in.
        {
          path: `${home}/auth.json`,
          content: JSON.stringify({ OPENAI_API_KEY: "sk-fake" }),
          mode: 0o600,
        },
        { path: files.prompt, content: codexPrompt(TASK) },
        { path: files.schema, content: JSON.stringify(TASK.schema) },
        { path: files.answer, content: "" },
      ]);
      // The app's flags, with the fake server as the model provider. The
      // last flag, "-", reads the prompt from stdin.
      const args = codexArgs(TASK, box.dir);
      const provider = [
        "-c",
        'model_provider="fake"',
        "-c",
        `model_providers.fake={name="fake", base_url="${baseUrl}", wire_api="responses", env_key="FAKE_KEY", supports_websockets=false}`,
      ];
      const { stdout, stderr } = await box.run(
        "bash",
        [
          "-c",
          `exec codex "$@" < ${files.prompt}`,
          "codex",
          ...args.slice(0, -1),
          ...provider,
          ...args.slice(-1),
        ],
        { env: { CODEX_HOME: home, FAKE_KEY: "sk-fake" }, timeoutMs: 100_000 },
      );
      return parseCodexRun(stdout, stderr, await box.readFile(files.answer));
    });

    expect(reply.output).toEqual(ANSWER);
    expect(reply.usage.output_tokens).toBe(40);
    expect(reply.usage.cache_read_input_tokens).toBe(200);
    expect(reply.requestId).toBeTruthy();

    const sent = requests.find((request) =>
      request.path.endsWith("/responses"),
    );
    expect(sent).toBeDefined();
    const body = JSON.parse(sent!.body) as {
      input: { type?: string; tools?: { tools?: { name?: string }[] }[] }[];
      text?: { format?: { schema?: unknown } };
      tools?: { name?: string }[];
    };
    // The prompt and the schema reached the model.
    expect(JSON.stringify(body.input)).toContain("Senior Frontend Engineer");
    expect(body.text?.format?.schema).toMatchObject({
      required: ["verdict", "reason"],
    });
    // No tool that runs commands or opens files, wherever Codex lists it.
    const tools = [
      ...(body.tools ?? []),
      ...body.input
        .filter((item) => item.type === "additional_tools")
        .flatMap((item) => item.tools ?? [])
        .flatMap((group) => group.tools ?? []),
    ].map((tool) => tool.name);
    expect(tools.length).toBeGreaterThan(0);
    for (const name of [
      "shell",
      "shell_command",
      "exec_command",
      "write_stdin",
      "view_image",
      "apply_patch",
    ]) {
      expect(tools).not.toContain(name);
    }
  }, 120_000);
});
