// A stand-in for the Claude API, for the smoke test. It answers each request
// with a response recorded in test/fixtures/claude, so the app's real SDK
// calls, parsing, cost logging and Inngest steps all run, at no cost.
//
// The app finds it through ANTHROPIC_BASE_URL. GET /__requests lists what
// the app sent, so the smoke test can check which settings a run used.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const FIXTURES = process.env.FIXTURES_DIR ?? "/fixtures";
const PORT = Number(process.env.PORT ?? 4010);
const BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`;

const load = (name) =>
  JSON.parse(readFileSync(join(FIXTURES, "claude", name), "utf8"));

// The first words of each step's system prompt, and its recorded response.
const MESSAGE_FIXTURES = [
  ["You read a candidate's CV", "parse-cv", "parse-cv-response.json"],
  ["You find open job postings", "discover", "discover-response.json"],
  ["You read one job posting", "extract", "extract-response.json"],
  [
    "You research a company",
    "company-snapshot",
    "company-snapshot-response.json",
  ],
  ["You tailor a candidate's", "tailor", "tailor-response.json"],
  ["You check a tailored", "claim-check", "claim-check-response.json"],
  ["You write a candidate's CV", "build-cv", "build-cv-response.json"],
  [
    "You read one email a job candidate",
    "read-email",
    "read-email-response.json",
  ],
  [
    "You check that the app can reach",
    "check-engine",
    "check-engine-response.json",
  ],
];

const batchFixture = load("score-batch.json");
const batchResults = readFileSync(
  join(FIXTURES, "claude", "score-batch-results.jsonl"),
  "utf8",
)
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .sort((a, b) => a.custom_id.localeCompare(b.custom_id));

// The recorded tailoring and built CV cite the fact ids of
// test/fixtures/profile.json. The app's profile has the same facts under new
// ids, so the ids in those responses and the claim check's are swapped for
// the live ones: the nth id with a prefix in the fixture profile becomes the
// nth in the app's.
const FACT_ID = /\b([a-z]+)_([a-z0-9]{8})\b/g;
const fixtureIds = idsByPrefix(
  readFileSync(join(FIXTURES, "profile.json"), "utf8"),
);
let idMap = new Map();

function idsByPrefix(text) {
  const byPrefix = new Map();
  for (const [id, prefix] of text.matchAll(FACT_ID)) {
    const ids = byPrefix.get(prefix) ?? [];
    if (!ids.includes(id)) ids.push(id);
    byPrefix.set(prefix, ids);
  }
  return byPrefix;
}

function buildIdMap(profileText) {
  const map = new Map();
  for (const [prefix, live] of idsByPrefix(profileText)) {
    (fixtureIds.get(prefix) ?? []).forEach((id, index) => {
      if (live[index]) map.set(id, live[index]);
    });
  }
  return map;
}

const swapIds = (value) =>
  JSON.parse(
    JSON.stringify(value).replace(FACT_ID, (id) => idMap.get(id) ?? id),
  );

const systemText = (system) =>
  typeof system === "string"
    ? system
    : (system ?? []).map((block) => block.text ?? "").join("\n");

const requests = [];
const batches = new Map();
let files = 0;

function send(res, status, body, requestId = "req_smoke") {
  const raw = typeof body === "string";
  res.writeHead(status, {
    "content-type": raw ? "application/binary" : "application/json",
    "request-id": requestId,
  });
  res.end(raw ? body : JSON.stringify(body));
}

function notFound(res, what) {
  send(res, 404, {
    type: "error",
    error: {
      type: "not_found_error",
      message: `The smoke fake has no ${what}.`,
    },
  });
}

function messages(body, res) {
  const system = systemText(body.system);
  const match = MESSAGE_FIXTURES.find(([start]) => system.startsWith(start));
  if (!match) return notFound(res, "recorded response for this prompt");
  const [, kind, file] = match;
  requests.push({ kind, model: body.model, body });
  const cites = ["tailor", "build-cv", "claim-check"].includes(kind);
  if (kind === "tailor" || kind === "build-cv") {
    idMap = buildIdMap(systemText(body.system));
  }
  const { requestId, body: response } = load(file);
  const swapped = cites ? swapIds(response) : response;
  send(res, 200, { ...swapped, model: body.model }, requestId);
}

function createBatch(body, res) {
  const ids = body.requests.map((request) => request.custom_id);
  const id = `msgbatch_smoke${String(batches.size + 1).padStart(6, "0")}`;
  batches.set(id, ids);
  requests.push({
    kind: "score-batch",
    model: body.requests[0]?.params.model,
    body: {
      count: ids.length,
      models: body.requests.map((r) => r.params.model),
    },
  });
  const { requestId, body: created } = batchFixture.created;
  send(
    res,
    200,
    {
      ...created,
      id,
      request_counts: { ...created.request_counts, processing: ids.length },
    },
    requestId,
  );
}

function getBatch(id, res) {
  const ids = batches.get(id);
  if (!ids) return notFound(res, `batch ${id}`);
  const { requestId, body: ended } = batchFixture.ended;
  send(
    res,
    200,
    {
      ...ended,
      id,
      results_url: `${BASE_URL}/v1/messages/batches/${id}/results`,
    },
    requestId,
  );
}

// One recorded result per request, in order, starting again from the first
// when there are more requests than recorded results.
function batchResultLines(id, res) {
  const ids = batches.get(id);
  if (!ids) return notFound(res, `batch ${id}`);
  const lines = ids.map((customId, index) =>
    JSON.stringify({
      ...batchResults[index % batchResults.length],
      custom_id: customId,
    }),
  );
  send(res, 200, `${lines.join("\n")}\n`, "req_smoke_results");
}

// GET /v1/models: the app checks a pasted key with it before saving it.
function modelList(res) {
  requests.push({ kind: "models-list", model: null, body: {} });
  send(res, 200, {
    data: [
      {
        type: "model",
        id: "claude-haiku-5-5",
        display_name: "Claude Haiku 5.5",
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    has_more: false,
    first_id: "claude-haiku-5-5",
    last_id: "claude-haiku-5-5",
  });
}

function model(id, res) {
  send(res, 200, {
    type: "model",
    id,
    display_name: id,
    created_at: "2026-01-01T00:00:00Z",
    capabilities: { server_tools: { web_search: { supported: true } } },
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", BASE_URL);
    const path = url.pathname;
    const raw = await readBody(req);
    const json = () => JSON.parse(raw.toString("utf8"));

    if (path === "/__health") return send(res, 200, { ok: true });
    if (path === "/__requests") return send(res, 200, requests);

    if (req.method === "POST" && path === "/v1/messages")
      return messages(json(), res);
    if (req.method === "POST" && path === "/v1/messages/batches")
      return createBatch(json(), res);
    let match = path.match(/^\/v1\/messages\/batches\/([^/]+)\/results$/);
    if (req.method === "GET" && match) return batchResultLines(match[1], res);
    match = path.match(/^\/v1\/messages\/batches\/([^/]+)$/);
    if (req.method === "GET" && match) return getBatch(match[1], res);
    if (req.method === "GET" && path === "/v1/models") return modelList(res);
    match = path.match(/^\/v1\/models\/([^/]+)$/);
    if (req.method === "GET" && match)
      return model(decodeURIComponent(match[1]), res);

    if (req.method === "POST" && path === "/v1/files") {
      files += 1;
      requests.push({
        kind: "file-upload",
        model: null,
        body: { bytes: raw.length },
      });
      return send(res, 200, {
        id: `file_smoke${String(files).padStart(6, "0")}`,
        type: "file",
        filename: "cv.pdf",
        mime_type: "application/pdf",
        size_bytes: raw.length,
        created_at: new Date().toISOString(),
        downloadable: false,
      });
    }
    match = path.match(/^\/v1\/files\/([^/]+)$/);
    if (req.method === "DELETE" && match)
      return send(res, 200, { id: match[1], type: "file_deleted" });

    notFound(res, `route for ${req.method} ${path}`);
  } catch (error) {
    send(res, 500, {
      type: "error",
      error: { type: "api_error", message: String(error) },
    });
  }
});

server.listen(PORT, () => {
  console.log(`Fake Claude API listening on ${PORT}`);
});
