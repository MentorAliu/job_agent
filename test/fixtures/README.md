# Test fixtures

Tests never call the live Claude API. They replay these responses through the
real SDK with `test/fake-anthropic.ts`.

- `claude/parse-cv-response.json`: a Messages API response for step 1 (read
  CV), with its `request-id` header. The CV in it is fictional ("Jordan
  Sample"). Never commit a response made from the owner's real CV.
- `claude/discover-response.json`: step 2 (discover), two web searches and
  their result blocks, including a board's front page and a repeated link.
- `claude/extract-response.json`: step 4 (extract facts), one web fetch and
  the structured facts. The page ends with an instruction the app must
  ignore. Its posting date is left empty on purpose, so the smoke test's
  role is never too old for a kit.
- `claude/score-batch.json` and `claude/score-batch-results.jsonl`: step 6
  (score) through the Message Batches API, a batch as created and as ended,
  and its results in a different order from the requests, with one error.
  Each score says the role's focus (frontend or backend).

- `profile.json`: the fictional "Jordan Sample" as a master profile with
  fixed fact ids, which the tailoring fixtures cite.
- `claude/company-snapshot-response.json`: step 7 (company snapshot), one web
  search and a brief whose text blocks cite two of the results.
- `claude/tailor-response.json`: step 8 (tailor), a CV, cover letter and
  answers for `profile.json`. Two CV bullets are planted fakes: one cites
  `hl_99999999`, which isn't in the profile (the code check flags it), and
  one turns "mentored 3 juniors" into "led a team of 12" (Claude's check
  flags it). The notice period and sponsorship answers are left for the
  owner.
- `claude/claim-check-response.json`: step 9 (claim check), one verdict per
  item: only the "team of 12" bullet is unsupported. It also has a verdict
  for a key that was never sent, which the app must ignore. The two bullets
  that repeat their cited highlight word for word aren't sent, so they have
  no verdict.

- `claude/build-cv-response.json`: a CV built with the CV builder for
  `profile.json`, with the tailored CV's bullets (both planted fakes
  included, so the same claim check fixture flags them), a summary aimed at
  the target title, and eight posting keywords: five the CV uses, one only
  the profile has (Figma), one only a planted claim has (GraphQL) and one
  nowhere (Accessibility).

- `claude/read-email-response.json`: reading one pasted employer's email,
  which Claude ties to the first listed application (`r1`) as an interview
  invite, quoting the sentence that says so, with a summary, key points and
  a suggested reply that leaves the candidate's free times as a
  placeholder.

- `claude/check-engine-response.json`: Check it works, the one tiny call
  setup and Settings make on the chosen provider, answering `{"ok":true}`.

- `cli/claude-code-stream.jsonl`: Claude Code's `--output-format
  stream-json` for a discover task, two web searches and the structured
  answer. Its shape and field names come from a real run of Claude Code
  2.1.312; the session ids, links and token counts are made up, and fields
  the app doesn't read are left out. The run's tokens are in `modelUsage`,
  which differs from the result's last-turn `usage` on purpose.
- `cli/claude-code-login-failure.jsonl`: the result line Claude Code gave in
  a Vercel Sandbox for a token that isn't valid, with its real message.
- `cli/codex-login-failure.jsonl`: `codex exec --json` 0.165.0 in a Vercel
  Sandbox with an auth.json that isn't valid: five reconnects, then
  `turn.failed`. Its ids are made up.
- `cli/codex-stream.jsonl`: a successful `codex exec --json` run with two web
  searches. It was written by hand from the documented events, not
  recorded, since no real ChatGPT sign-in was available.

- `openai/discover-response.json`: a Responses API response for a discover
  task on GPT-6 Luna: a reasoning item, two searches and one opened page,
  then the structured answer. `tool_usage` bills the two searches only.
  The usage counts cached and newly cached tokens inside `input_tokens`.
- `openai/refusal-response.json`: a response whose message is a refusal.
- `openai/insufficient-quota-error.json` and `openai/invalid-key-error.json`:
  the error bodies OpenAI sends with a 429 for an account out of credit and
  a 401 for a wrong key.

  The OpenAI fixtures were written by hand from the types in the `openai`
  package 7.47.0 and OpenAI's docs, not recorded, since no OpenAI API key
  was available. Their ids are made up.

The companies, postings and links in the step 2 to 9 and built CV
fixtures, and the email in the read-email fixture, are made up. They were
written by hand in the API's response format, not recorded.
