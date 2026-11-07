# Job Agent Spec

As of 17 October 2026, simplified on 19 October 2026 (see "After v1: Simpler app" at the end). In this spec, "you" means the app's owner, not the coding agent. The human-readable version, with diagrams, is the "Job Agent Spec" doc.

## Summary

Job Agent is a single-user app. Claude finds remote roles the owner can actually take from where they live, scores them against the owner's CV, and prepares a tailored CV, cover letter and form answers for the strongest matches by itself. The owner submits each application. Every screen is there to read; the only clicks most days are Open the application and Mark as applied. Every role, document and status stays in one tracker.

| Decision | Choice | What it means for the build |
| --- | --- | --- |
| Applying | Claude prepares, you submit | No browser automation or CAPTCHAs. Each role gets an apply kit with files and copy-ready answers |
| Finding roles | Claude web search | Claude's web search and web fetch tools, steered toward company job boards and remote job sites |
| Users | Just you | One login, no billing, no separating users' data. Still behind sign-in so it can move to Vercel |
| Statuses | Your pasted emails update them | No inbox access. Paste each email a company sends; Claude says what it means, the code moves the role on, and a reply is ready to copy |
| Tailoring | The app picks, you submit | Every role gets cheap scoring. Roles scoring 75 or more get a kit by themselves, up to 3 a day and within the budget: the kind of role the owner wants most first (frontend, say), then the newest postings. Prepare kit does the same for any other role |
| Search runs | Daily plus on demand | A scheduled morning run and a Search now button, both as background jobs |
| Database | PostgreSQL with Drizzle | Schema and queries in TypeScript |

Not in v1: submitting forms for you, reading your inbox, other users, and scraping LinkedIn or Indeed. After v1 came a form filler that stops short of Submit, and a box to paste employers' emails into, which moves each role on and drafts the reply. The app still never reads the inbox, sends an email or submits a form.

## Features

v1 covers the whole loop, from CV to submitted application. Items under Later wait until the owner has used v1 for a couple of weeks.

| Area | v1 | Later |
| --- | --- | --- |
| Profile | Upload a CV (PDF or DOCX). Claude turns it into the master profile and saves it, with nothing to review. The profile page is a summary to read, with an Edit link on each part for a rare correction. Job preferences: remote only, countries you can work from, time zones, seniority, stack, salary floor, companies to exclude. Saved standard answers: notice period, work authorization, links. The saved LinkedIn, GitHub and portfolio go on forms and at the top of CVs and cover letters, in place of the profile's own | Profile variants (frontend vs full-stack). A bank of achievement stories with numbers |
| Discovery | Daily run plus a Search now button. Web search steered to job boards and company career sites (ATS domains), plus one search of the rest of the web for postings on companies' own careers pages. Each search first reads the public job boards of companies that already posted a role you can take, for their new postings, and the feeds Remote OK, We Work Remotely, Jobicy and Himalayas publish for apps. Job sites whose terms forbid scraping or that block bots, such as LinkedIn and Indeed, are left out. Each full posting is read with web fetch, or from the feed's text. Duplicates are merged across runs. Add a role on the Roles page from its link, with its text for a site apps can't read | Company watchlist |
| Eligibility and scoring | Key facts go into fields: location rule, time zone window, salary, stack, seniority, contract type, deadline. A hard eligibility check that quotes the posting's own words. The day each posting went up. A 0–100 match score with reasons and gaps, and what the role mainly works on. Any frontend role at your seniority is a strong match whatever its framework | Scoring tuned on your past shortlist and skip decisions |
| Picking | After each search, the app picks roles scoring 75 or more (up to 3 kits a day, in the owner's time zone) and writes their kits: the kind of role the owner wants most first, then the kinds near it, then the rest, and the newest postings first within each. Strong roles over the daily limit wait as Next up. Postings more than 21 days old are passed over. No reasons to enter | Scoring tuned on which kits you send |
| Tailoring | For picked roles: the CV reworded and reordered from your master profile only, plus a cover letter and answers to likely screening questions. Every claim is traced to a profile fact, and anything new is flagged. Diff against your master CV. PDF and Word file in the CV design picked in Settings. The CV uses the posting's keywords wherever the profile backs them, and the kit shows which of them it covers, as built CVs do | |
| CVs | A CV builder: a short form filled in from the profile (job title, an optional pasted posting, skills to lead with, one or two pages, sections, a note), so building one can be one click. Claude writes it from profile facts only, with the same claim check as a kit, in one of four ATS-friendly designs (Modern, Classic, Executive, Minimal), which can be switched afterwards with no AI call. The CVs page keeps every CV the app made, built or tailored, to view in the app or download, and each built CV's page shows its ATS check: layout, length, claims, and which of the posting's keywords it covers. The CVs page shows them as cards with their first page, on a General tab and a Tailored for a job tab, and any CV can be edited into a new one by keeping, removing and adding lines from the profile. Every CV and cover letter downloads as a PDF or a Word file | |
| Apply kit | One page per role: the CV and cover letter to view in the app or download, copy buttons for the letter and each answer, and the apply link. Mark as applied is one click and records the date and the exact files you sent. A small status menu stays for the rare manual change | Built in Phase 6: a Chrome extension that fills the form from the kit, while you still click Submit |
| Overview, Roles and Applications | The Overview: KPIs (sent this month, reply rate, interviews, spend), the companies waiting for your reply, kits ready to send, a 30-day funnel, Next up and what happened lately. Roles: a read-only list with tabs (To send, Waiting, Passed over, All), quick filters (New since your last visit, Score 75+, Salary listed) and an order, all kept in the URL. A top bar above every page shows how the daily search is doing, the roles new since your last visit, and the next reply or kit to send. Applications: every role applied to, filtered by whose move it is (Your turn, Waiting on them, Interviewing, Offers, Closed), by company or role and by when you applied, with the box to paste an email. Each role's page shows its emails, why it scored, its key facts and its timeline | Kanban view. CSV export |
| Insights | A company snapshot for picked roles. Red flags: unpaid test projects, vague pay, location mismatch | Weekly stats: applications sent, response rate by source and role type. Interview prep notes when a role moves to Interviewing |
| Runs and cost | Run history showing tokens and cost per stage. A monthly budget cap and a per-run limit. Pause the daily run. Settings holds only the daily search switch, what the agents run on (the Claude API, or Claude Code or Codex on the owner's own plan), the monthly budget, the form filler card, and the theme | Email digest of new matches |

## How the agent works

Claude runs as a fixed pipeline of small Messages API calls inside Inngest steps, not as one open-ended agent. Each step has one job, the cheapest model that does it well, and only the tools it needs. Each step's model is fixed in code (`DEFAULT_STAGE_MODELS`). Settings can send the same steps to Claude Code or Codex on the owner's own plan, or to the OpenAI API with the owner's key, instead (see "After v1: Agents on your own plan" and "After v1: The OpenAI API"); the steps, prompts and schemas stay the same.

Who does what: Claude finds and scores (steps 2–6) → the app picks roles scoring 75 or more → Claude tailors (steps 7–10) → you submit on the job's own site and press Mark as applied. Claude never contacts an employer or submits a form.

| Step | Runs when | Model | Tools | Output |
| --- | --- | --- | --- | --- |
| 1. Read CV | You upload a CV | Sonnet 5.5 | None. A PDF goes through the Files API. A DOCX is turned into text first with mammoth | `MasterProfile`: every fact has an id |
| 2. Discover | Daily at 07:00, or Search now | Haiku 5.5 | Web search, at most 3 searches per call: one call per group of job-board domains, and one on the rest of the web that leaves those and the off-limits job sites out. Before the searches, code reads the public job boards (plain HTTP, no Claude call) of up to 40 companies that already posted a role you can take, and the feeds of four remote job boards, each at most once an hour | Candidate URLs, which the code reads from the search result blocks. Up to 10 new developer postings from the company boards come first: frontend, then full-stack, then others, none junior, hybrid, on-site or more than 21 days old. Then up to 15 from the feeds, by the same rules and open to your country as far as the board says. A board whose feed answered isn't searched in that run |
| 3. Dedupe | After step 2 | Code | — | Only postings not seen before |
| 4. Extract facts | Each new posting, 5 at a time | Haiku 5.5 | Web fetch, one page. None for a feed's posting or one the owner pasted, which is read from its text | `JobFacts`: the location rule with its exact quote, time zones, salary, stack, seniority, contract, deadline, application rules. The day it was posted: from the employer's tracking system, else the page's `datePosted`, else the page's own words, kept only when they're on the page |
| 5. Eligibility | After step 4, and on roles not sent yet at the start of each search | Code | — | Eligible, not eligible or unclear, from the quoted rule against your countries and time zones. With remote only on, a role that isn't fully remote (hybrid, on-site, or the posting doesn't say) is not eligible. A role not sent yet that the check now rules out moves to Not eligible, with the reason on its timeline |
| 6. Score | Eligible and unclear postings | Haiku 5.5, with your profile cached | None | A 0–100 score, with reasons and gaps, and the role's focus (frontend, full-stack, backend, mobile or other). The kind of role you want most is strong at your seniority whatever its framework, and everyday tools such as Vite or Docker never count against a role |
| 7. Company snapshot | The app picks a role after a search, or you press Prepare kit | Haiku 5.5 | Web search, up to 3 searches | A short brief, shown with its citations |
| 8. Tailor | After step 7 | Sonnet 5.5 | None | CV, cover letter and answers. Each bullet cites the profile fact ids it comes from. The request lists the posting's keywords the profile states, picked by code with no Claude call: the stack from step 4, then the profile's own skills and technologies the posting names |
| 9. Claim check | After step 8 | Code, then Haiku 5.5 | None | A flag on any bullet whose source is missing or doesn't support it |
| 10. Render | After step 9 | Code | — | A PDF from `@react-pdf/renderer`, and the apply kit marked Ready |
| 11. Read an email | You paste an email from a company | Sonnet 5.5 | None | Which application it's about, what it means (received, rejected, interview, assessment, offer, other, unrelated) with the sentence that shows it, a summary, key points and a suggested reply. Code checks the quote and decides any status change |
| 12. Build a CV | You build one on the CVs page | Sonnet 5.5, with your profile cached | None | A CV aimed at the job title and the pasted posting, if any, with the posting's keywords. Each bullet cites its facts. Then steps 9 and 10 as for a kit, leaving out older bullets until it fits the length asked for |
| 13. Check listings | Daily at 06:30, before the search | Code | Plain HTTP: the public job-board APIs of Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee, else the posting's page | Roles not sent yet (Waiting, Picked, Ready) whose listing the employer closed move to Listing closed, with the reason on the timeline. Only a clear sign counts: the employer's system says it's gone, the page is gone (404 or 410), the link now opens the site's list of jobs, or the page says it's closed. A blocked or failed check changes nothing. It also notes the day each posting went up, where the role has none yet |
| 14. Add a role | You add one on the Roles page | Haiku 5.5 | Steps 4 to 6 on one posting, scored in one request rather than a batch | The role, marked as added by you. If you can take it and its company isn't excluded, it's picked and its kit starts, whatever its score. A link the app already has isn't read again |

Model IDs: `claude-haiku-5-5`, `claude-sonnet-5-5`. Server tools: `web_search_20260318`, `web_fetch_20260318`. Before choosing Haiku 5.5 for steps 2 and 7, check `capabilities.server_tools.web_search.supported` in the Models API, and fall back to Sonnet 5.5 for those steps if it isn't listed.

Design rules, from the Claude API docs:

- **Structured output wherever the API allows it.** Calls use `messages.parse()` with `zodOutputFormat()` on the same Zod schemas the app uses. This is generally available and needs no beta header. Web search always returns citations, and the structured outputs page lists citations as incompatible with JSON outputs. So steps 2 and 7 return plain text, and the code takes the URLs from the result blocks. Web fetch citations are off by default, so step 4 can use structured output ([structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)).
- **Web pages and your data never share a call.** Steps that search or fetch see only your search criteria, never your CV. Steps that see your profile have no tools. This closes the exfiltration path the [web fetch docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) warn about. Posting text is treated as data, and the system prompt tells Claude to ignore any instructions inside it.
- **No invented experience.** Every tailored bullet must cite the profile fact ids it comes from. The code rejects bullets with no valid source. Haiku then checks that each bullet is actually supported by the facts it cites, and the diff view shows every change against your master CV.
- **Lower cost per call.** Your profile and the instructions are cached across scoring, tailoring and CV builds, and the email instructions across email reads. Scoring uses the 1-hour cache, as the docs advise for batches. Steps 2 and 7 turn caching on, so the API caches each search's results for the next search in the same call ([tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching)). Cache reads cost 0.1× the normal input price on Haiku 5.5 and 0.05× on Sonnet 5.5 ([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)). Steps 1, 4 and 9 don't cache: a CV is read once, a posting's page is read once per call, and the claim check's fixed prompt is under the 512-token minimum. On Haiku 5.5, extraction and scoring send `output_config: { effort: "low" }` and `thinking: { type: "disabled" }`.
- **Every Haiku request stays under 100K input tokens.** Haiku 5.5 costs $0.10 / $0.50 per million input / output tokens up to that size and $0.50 / $2.50 above it. So discover calls make at most 3 searches, extract calls handle one posting, and web fetch has a `max_content_tokens` cap.
- **Every call is logged** to `llm_call`, with input, output, cache and web-search counts, and its cost from the price table in `lib/schemas/settings.ts` (the settings row's `prices` column can override it).
- **Messages API rather than the Agent SDK.** The Agent SDK runs the Claude Code binary as a subprocess in a long-lived container. That doesn't fit Vercel Functions, and this pipeline doesn't need it ([Agent SDK hosting](https://code.claude.com/docs/en/agent-sdk/hosting)). When Settings picks Claude Code or Codex, each step runs the published CLI, one-shot: in a short-lived Vercel Sandbox on Vercel, and in an empty folder inside the app's own container elsewhere.
- **Later: Message Batches for the daily scoring.** Batches are 50% cheaper, and most finish within an hour. At Haiku 5.5 prices, the savings don't yet justify the extra waiting logic.

## Architecture

In the request (returns in milliseconds):

- The browser loads pages from **Server Components**, which read through `lib/dal`.
- It polls **Route Handlers** under `/api/*`, which serve TanStack Query.
- It submits to **Server Actions**, which make Zod-checked writes and send Inngest events.
- All three read and write Postgres through `lib/dal`.

In Inngest steps (minutes, retried on failure):

- The **Inngest server** (cron at 07:00, retries, one run at a time) calls `/api/inngest` for each step.
- The steps call the Claude API: Messages, web search and fetch, the Files API and structured output.
- They write results and costs to Postgres and files to storage.

Server Actions only record the change and send an event, so no request ever waits on Claude. On Vercel the same pieces become Vercel Functions, Inngest Cloud, Neon or Supabase, and Vercel Blob.

## Data model

The data lives in nineteen Postgres tables, defined in `db/schema.ts` with Drizzle. Some columns store JSON: the profile, a job's key facts, the contents of a document. Those columns are checked against the same Zod schemas used by the forms, the Server Actions and Claude's structured outputs.

| Table | Holds | Key fields |
| --- | --- | --- |
| `profile` | Your current master profile (one row) | `data`, `preferences`, `answers` (all jsonb), `cv_file_id`, `updated_at` |
| `profile_snapshot` | A frozen copy of the profile, saved each time it changes | `profile_data` (jsonb), `created_at` |
| `job` | One posting, merged across runs | `canonical_url`, `dedupe_key` (unique), `apply_url`, `company`, `title`, `description_md`, `facts` (jsonb), `eligibility` (eligible, not eligible or unclear), `eligibility_quote`, `score`, `score_reasons` (jsonb), `focus` (frontend, full-stack, backend, mobile or other), `posted_on`, `status`, `notes`, `follow_up_on`, `first_run_id`, `added_by_owner`, `found_at` |
| `document` | A tailored CV, cover letter or set of answers | `job_id`, `kind`, `version`, `snapshot_id`, `content` (jsonb), `claim_flags` (jsonb), `pdf_file_id`, `edited` (the owner made this version in the CV editor) |
| `application` | What you actually sent | `job_id` (unique), `applied_at`, `cv_document_id`, `letter_document_id`, `answers_document_id` |
| `event` | The timeline for each role | `job_id`, `type`, `payload` (jsonb), `at` |
| `run` | One search run | `trigger` (scheduled or manual), `status`, `started_at`, `finished_at`, `stats` (jsonb), `cost_usd` |
| `llm_call` | Every Claude request, for cost tracking | `run_id`, `job_id`, `stage`, `engine` (Claude API, Claude Code or Codex), `model`, token counts, `web_searches`, `cost_usd` ($0 on Claude Code or Codex), `request_id` (the agent's session id on Claude Code or Codex) |
| `file` | Uploaded and generated files | `kind`, `storage_key`, `mime`, `sha256`, `anthropic_file_id` |
| `settings` | App settings (one row) | the monthly budget, daily run on or off, and `agent_engine` (what the agents run on). Older columns (per-run cap, models, search domains) stay but are no longer read |
| `engine_state` | One row per engine other than the Claude API | `login` (Codex's auth.json or the OpenAI API key, encrypted), `login_saved_at`, `lease_id` and `lease_until` (the step using Codex's sign-in), `last_ok_at`, `issue` and `issue_at` (why a step last ran on the API instead) |
| `seen_link` | A posting link a search already read and dropped, so it isn't read again | `dedupe_key`, `url`, `reason`, `try_again` |
| `feed_posting` | The postings worth reading from a job board's feed, kept from its last answer | `dedupe_key`, `feed`, `canonical_url`, `apply_url`, `title`, `company`, `places` (jsonb), `posted_on`, `text` |
| `feed_check` | When each board's feed was last asked for, so it's asked at most once an hour | `feed`, `checked_at`, `ok` |
| `added_role` | A role the owner added on the Roles page, and what came of it | `url`, `text` (pasted, or empty), `status` (reading, done or failed), `note`, `job_id` |
| `job_email` | An email the owner pasted, and what Claude made of it | `job_id` (null until the role is known), `body`, `status` (reading, done or failed), `author`, `outcome`, `sure`, `quote`, `summary`, `key_points`, `reply` (jsonb), `handled_at` |
| `built_cv` | A CV built with the CV builder, with no role | `request` (jsonb: job title, posting, skill ids, length, sections, note), `snapshot_id`, `status` (writing, checking, rendering, ready or failed), `error`, `content`, `keywords`, `claim_flags` (jsonb), `pdf_file_id`, `page_count`, `trimmed`, `ready_at`, `edited` (made in the CV editor, with no Claude call) |

A role's status is one of New, Shortlisted, Ready (apply kit generated), Applied, Interviewing, Offer, Rejected, No response or Withdrawn. Roles the app passes over are marked Skipped or Not eligible. A role whose listing the employer took down before the owner applied is Listing closed. A role the owner removes is Removed: only the Removed tab lists it, Restore puts it back at its earlier status, and later searches don't bring it back. Roles applied to can't be removed. The screens call New "Waiting", Shortlisted "Picked" and Skipped "Passed over".

Better Auth's tables (user, session, account, verification) are generated with `npx auth@latest generate` into `db/auth-schema.ts`. They're passed to `drizzleAdapter(db, { provider: "pg", schema })` and migrated with drizzle-kit like the app tables. Better Auth's own `migrate` command only works with its built-in Kysely adapter.

## Stack

These versions were current on npm on 17 October 2026. They were installed together in a fresh `create-next-app` 16.4.2 project, and the APIs this spec relies on (TanStack Query and Table, Drizzle, Better Auth, Inngest, nuqs, Zod and the Claude SDK) type-check against them.

| Library | Version | Role here |
| --- | --- | --- |
| [Next.js](https://nextjs.org/docs) | 16.4.2 (React 19.3) | App Router, Server Components, Server Actions, Cache Components, standalone output for Docker |
| [shadcn/ui](https://ui.shadcn.com/docs) | CLI 4.x | Components (Base UI by default since July 2026), `Field` forms, the Data Table pattern. Also available as an MCP server and an agent skill |
| [Recharts](https://recharts.github.io), through shadcn's [Chart](https://ui.shadcn.com/docs/components/base/chart) | 3.8 | The Runs page's spend and cost-by-step charts and the Overview funnel, colored from the `--chart-*` and `--funnel-*` tokens |
| [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview) | 5.104 | Client cache, polling, mutations, prefetching in Server Components |
| [TanStack Table](https://tanstack.com/table/latest/docs) | 9.3 | The tracker, with server-side pagination, sorting and filtering |
| [React Hook Form](https://react-hook-form.com/docs) and resolvers | 7.90 and 5.9 | Forms, with `zodResolver` |
| [Zod](https://zod.dev) | 4.6 | One schema each for forms, actions, database inserts and Claude outputs |
| [nuqs](https://nuqs.dev/docs) | 2.10 | Table filters, sorting and page kept in the URL |
| [Drizzle ORM and drizzle-kit](https://orm.drizzle.team/docs/get-started/postgresql-new) | 1.0.0-rc.4 | Schema, migrations, and Zod schemas from `drizzle-orm/zod` |
| [PostgreSQL](https://www.postgresql.org/support/versioning/) with `pg` | 18, driver 8.23 | The database, using the same driver in Docker and on Vercel |
| [Better Auth](https://www.better-auth.com/docs/integrations/next) | 1.7 | Sign-in for the owner only, through the Drizzle adapter |
| [Inngest](https://www.inngest.com/docs) | SDK 4.24 | Durable steps, retries, cron, concurrency limits |
| [Claude API TypeScript SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript) | 0.135 | Messages API, structured output, web search and fetch, Files API |
| [@react-pdf/renderer](https://react-pdf.org) | 4.9 | CV and cover letter PDFs, with no browser needed |
| [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | 6.4 | The in-app PDF viewer, read-only: Mozilla's own viewer parts, the ones inside Firefox |
| [mammoth](https://github.com/mwilliamson/mammoth.js) | 1.13 | Turns an uploaded DOCX into text |
| [docx](https://docx.js.org) | 9.14 | Writes CVs and cover letters as Word files |
| [Vitest](https://vitest.dev) and Prettier | 5.0 and 3.9 | Tests for the Done-when checks, and formatting |

Install commands for Phase 0:

```bash
pnpm add @tanstack/react-query @tanstack/react-table react-hook-form @hookform/resolvers zod nuqs drizzle-orm@1.0.0-rc.4 pg better-auth inngest @anthropic-ai/sdk @react-pdf/renderer mammoth server-only
pnpm add -D drizzle-kit@1.0.0-rc.4 @types/pg @tanstack/react-query-devtools @tanstack/eslint-plugin-query vitest prettier dotenv
```

Why these over the alternatives:

- **Inngest** runs the same code in Docker and on Vercel. The alternatives each have a blocker:
    - Trigger.dev self-hosting asks for 3+ vCPUs and 6 GB for its web app, plus 4 vCPUs and 8 GB for workers.
    - The Workflow SDK's self-hosted Postgres backend needs a long-running worker and can't run on Vercel.
    - BullMQ workers can't run on Vercel either.
- **Better Auth.** Auth.js is now maintained by the Better Auth team, who recommend Better Auth for new projects ([announcement](https://www.better-auth.com/blog/authjs-joins-better-auth)). Clerk is a hosted service, which is more than one user needs.
- **Drizzle 1.0 RC.** Drizzle's own docs now install the `@rc` versions everywhere, and `drizzle-orm/zod` replaces the separate `drizzle-zod` package. Pin exact versions until 1.0 ships.
- **`pg`** is the driver in Drizzle's getting-started guide. On Vercel it pairs with `attachDatabasePool`, following Vercel's [connection pooling guide](https://vercel.com/kb/guide/connection-pooling-with-functions).

## Data fetching and state

Server Components load each page's first data straight from Postgres, through a data access layer. TanStack Query takes over only for data that changes while the page is open. This follows the TanStack guide's advice to "treat Server Components as a place to prefetch data" ([advanced SSR](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr)).

| Screen | First load | While it's open | Writes |
| --- | --- | --- | --- |
| Overview `/` | A Server Component reads the KPIs, the funnel, the lists and the recent events through `lib/dal` | — | None |
| Roles `/jobs` | A Server Component reads the tab and page from the URL with nuqs `createLoader` and lists that page. `/inbox` redirects here | Tabs and pages are links | Remove and Restore on each row: Server Actions that call `refresh()` |
| Run progress (`/runs` and `/runs/[id]`) | `/runs` renders the latest run; `/runs/[id]` prefetches the run into TanStack Query | `useQuery` polls `GET /api/runs/[id]` every 2 s while the run is active, and stops when it ends | Search now: a Server Action sends the Inngest event |
| Role `/jobs/[id]` | A Server Component prefetches the kit, its emails and the role's details into TanStack Query, streamed in separate `<Suspense>` sections | Polls the kit only while tailoring runs, and the emails while Claude reads one | Mark as applied (which then opens the application's page), Prepare kit, Remove or Restore, and the status menu: Server Actions with optimistic updates |
| Application `/applications/[id]` | A Server Component prefetches the role, its kit and its emails into TanStack Query, and sends a role not applied to yet to its kit | Polls the emails while Claude reads one, then refetches the role and its kit | Paste, Copy reply and Mark as replied: Server Actions with optimistic updates |
| Applications `/applications` | A Server Component lists the applications from the URL's filters, and prefetches the pasted emails into TanStack Query | Polls the pasted emails while Claude reads one, then refreshes the page | Email actions: Server Actions that call `refresh()`, with optimistic updates |
| Profile and settings | Profile is a read-only summary; its Edit pages and Settings load the values as `defaultValues` | The CV card polls a new upload until Claude has saved it, then refreshes the page | React Hook Form with `zodResolver` checks input in the browser. `handleSubmit` calls the Server Action, which checks it again with the same Zod schema and returns field errors from `z.flattenError` |

Rules the code follows:

- **Every read goes through `lib/dal/`.** The data access layer is server-only, checks the session, and returns minimal objects ([data security](https://nextjs.org/docs/app/guides/data-security)). Route Handlers and Server Components both call it.
- **Server Actions are for writes only, never a `queryFn`.** They run one at a time, so reads go through Route Handlers.
- **One query client per request on the server, and one shared client in the browser.** `staleTime` is 60 s, pending queries are dehydrated so they stream, and errors aren't redacted so Next.js sees its own, as the TanStack guide sets it up (`environmentManager.isServer()`).
- **Every query is a `queryOptions` factory** (`lib/jobs/queries.ts`, `lib/run-polling.ts`), so the server's prefetch and the browser's hook share one key and one type. TanStack's strict ESLint config (`prefer-query-options`) enforces it ([query options](https://tanstack.com/query/latest/docs/framework/react/guides/query-options)).
- **Data a Server Component hands to TanStack Query goes through `<HydrationBoundary>`.** The Server Component prefetches with `queryClient.query`, swapping in a `queryFn` that reads `lib/dal`, and the Client Component reads it with `useSuspenseQuery`. Never `initialData`: it never replaces data already in the cache, so a page opened again would show what it held last time ([SSR guide](https://tanstack.com/query/latest/docs/framework/react/guides/ssr#get-started-fast-with-initialdata), [Next.js guide](https://nextjs.org/docs/app/guides/client-side-data-fetching/tanstack-query)).
- **Cache Components is on.** `create-next-app` writes `cacheComponents: true` and `partialPrefetching: true` into `next.config.ts`, so keep both when adding the `NEXT_OUTPUT` switch. The layout and navigation prerender as a static shell. Anything that reads the session sits inside `<Suspense>` ([caching](https://nextjs.org/docs/app/getting-started/caching)). Per-user data isn't cached with `use cache` in v1. Server Actions call `refresh()` when a Server Component's data changed.
- **URL state uses nuqs on the server.** Roles and Applications read their filters with `createLoader` and link to other views with `createSerializer`, so each change is a server render ([nuqs](https://nuqs.dev/docs/server-side)).
- **Forms follow shadcn's React Hook Form guide:** `Field`, `FieldLabel` and `FieldError`, with `Controller` and `zodResolver` ([guide](https://ui.shadcn.com/docs/forms/react-hook-form)).
- **Live progress uses polling rather than websockets.** Polling works the same in Docker and on Vercel.

## Docker now, Vercel later

Locally the app runs as Docker Compose services (see `compose.yml`). Moving to Vercel swaps each one for a managed service, and the code stays the same.

| Piece | In Docker (now) | On Vercel (later) |
| --- | --- | --- |
| Web app | `web`: a Next.js standalone build from the official [with-docker](https://github.com/vercel/next.js/tree/canary/examples/with-docker) Dockerfile (Node 24 slim, runs as a non-root user) | Vercel Functions with Fluid compute: 300 s per request by default, up to 800 s on Pro ([limits](https://vercel.com/docs/functions/configuring-functions/duration)) |
| Background jobs | `inngest`: the `inngest/inngest` image running `inngest start`, which calls the app's `/api/inngest` route. History goes in Postgres and queue state in `redis` ([self-hosting](https://www.inngest.com/docs/self-hosting)) | Inngest Cloud through its Vercel integration |
| Database | `db`: `postgres:18` with a named volume | Neon or Supabase from the Vercel Marketplace, using the pooled connection string |
| Migrations | `migrate`: a one-off container that runs `drizzle-kit migrate` before `web` starts | The same command in the build step or in CI |
| Files | A `files` volume mounted into `web` | Vercel Blob, behind the same storage module |

What keeps the move cheap:

- **Settings come from environment variables at runtime,** so one image serves every environment ([self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting)). `next.config.ts` sets `output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined`. The Dockerfile sets `NEXT_OUTPUT`.
- **Each pipeline stage is its own Inngest step,** and each step is a separate request. No single request has to outlast Vercel's time limit.
- **The daily run is scheduled by a clock in code:** a cron trigger every 6 hours, ``cron(`17 */6 * * *`)`` ([Inngest cron](https://www.inngest.com/docs/guides/scheduled-functions)), and the event setup and Settings send when they save the time zone, read the owner's time zone from the database and send the morning events of the next 20 hours, each with its start time as `ts` ([a `ts` in the future schedules the run](https://www.inngest.com/docs/reference/events/send)): the listing check at 06:30, the daily search at 07:00 and the no-reply check at 07:30, in that time zone. Each event's id is the job, the owner's day and the time zone, so Inngest drops the repeats and each starts once, and a run scheduled in a time zone the owner has since changed does nothing. Reading the time zone 4 times a day, not every half hour, lets a database that sleeps when idle, such as Neon's, sleep. The daily search sends a `search/run.requested` event. Search now sends the same event, and one event-triggered function with `concurrency: { limit: 1 }` runs the pipeline. Nothing starts before first-run setup is finished, and the daily search sends nothing when Settings has the daily run turned off.
- **PDFs are rendered with `@react-pdf/renderer` in plain Node,** so neither Docker nor Vercel needs Chromium.
- **Files sit behind a storage module with two drivers,** local disk and Vercel Blob. `STORAGE_DRIVER` picks which one is used.

## Security, privacy and cost

The two things worth protecting are the owner's CV and an API key that spends money. So everything sits behind the owner's login, and every Claude call is capped and logged.

**Security and privacy**

- **One account.** Better Auth with email and password. A database hook allows only the first sign-up, and only with the setup code that comes from `BETTER_AUTH_SECRET` (`lib/auth/setup-code.ts`): `scripts/setup.mjs` prints it, and the sign-in page logs it while no account exists. Sign-in and sign-up tries are rate limited, counted in the database. `scripts/reset-password.mjs` sets a new password, since the app sends no email. `proxy.ts` only does a quick cookie check. The data access layer checks the session on every read and write, as the Next.js [auth guide](https://nextjs.org/docs/app/guides/authentication) requires.
- **Inputs are untrusted.** Every Server Action and Route Handler validates its input with Zod and checks the session itself. CV uploads go through a Route Handler, because Server Actions accept 1 MB by default ([Server Actions guide](https://nextjs.org/docs/app/guides/server-actions)).
- **Secrets stay on the server.** Only `lib/dal/` and `lib/claude/` read secrets from the environment, and both import `server-only`. Don't validate env vars at import time in a way that breaks `next build` inside Docker.
- **The Files API.** An uploaded CV is visible to every key in its Claude workspace, so the app gets a dedicated workspace and key. Delete the old file when the CV is replaced ([Files API](https://platform.claude.com/docs/en/build-with-claude/files)).
- **Fetched text is shown as plain text.** Posting descriptions render without raw HTML, so a page can't inject markup into the app.
- **The app only fetches public websites.** The listing check, the company board watch and the page reads (`lib/jobs/public-fetch.ts`) fetch a link, and each redirect, only when it has a public host name on the usual port and every address the name points to is public: never this computer, a private network or a cloud server's metadata address, so a posting can't point the app at what's around it.
- **Pages keep to themselves.** Every response says no other site may frame the app (`X-Frame-Options`, `frame-ancestors`), so a page can't trick the owner into clicking its buttons, and links to employers send no referrer. The CV upload refuses a form another site, or another app on the same computer, posts with the owner's cookie (`Sec-Fetch-Site`). Signing in goes back to the page the owner asked for, and only to a path in the app.
- **PDFs open read-only.** The in-app viewer is PDF.js 6.4, which has the fixes for CVE-2024-4367 and CVE-2026-16633. It runs without a scripting manager, so JavaScript in a PDF never runs, with XFA off, form fields drawn but not editable, the editor off, and links opening in a new tab with `noopener noreferrer nofollow`. Its worker is served by the app itself, and files come only from the app's own Route Handlers, which check the session and send `attachment` and `nosniff`.
- **Pasted emails, no mailbox.** The app never connects to a mailbox and never sends an email: the owner pastes each one, and copies the suggested reply into their own email client. The pasted text is kept with its role, since the next email's reading uses it. Claude reads it once, fenced off as data, with an instruction to ignore anything in it that asks for something. Code checks that Claude's quote is in the email and decides any status change; an email Claude isn't sure about changes nothing.
- **The form filler never submits.** It fills fields and attaches the PDFs; the owner checks the form and presses Submit. It leaves salary and demographic questions alone. It talks to the app with the owner's session cookie, so it works only where the owner is signed in.
- **Command-line agents stay boxed in.** With Claude Code or Codex picked, each step runs in its own Vercel Sandbox that can reach only that agent's servers (on Vercel), or in a new empty folder in the app's container with none of the app's environment but what a program needs to run and reach the internet (elsewhere), with no MCP servers, skills, saved sessions or the owner's settings, and with no tools but web search for steps 2 and 7. Step 4 gets the page's text from the app, so the agent fetches nothing. Codex runs read-only with its shell and file tools turned off, so a posting can't get it to read its own sign-in into an answer. The same split holds as on the API: steps that search see only the criteria, steps that see the profile have no tools. Codex's auth.json and the API keys pasted in setup or Settings are kept encrypted (AES-256-GCM, with a key derived from `BETTER_AUTH_SECRET`) and never shown again; Claude Code's token is a Sensitive environment variable.
- **Job sites' rules.** LinkedIn's and Indeed's terms forbid scraping and automated applications. The app never logs into them and never submits a form. Some postings ask candidates not to use AI. The extract step records that rule, and the apply kit shows it at the top.

**Expected cost: about $7 a month.** This is an estimate from the official [prices](https://platform.claude.com/docs/en/about-claude/pricing):

- Haiku 5.5: $0.10 / $0.50 per million input / output tokens for requests under 100K tokens, which the pipeline keeps to. Above that it's $0.50 / $2.50.
- Sonnet 5.5: $2 / $10.
- Web search: $10 per 1,000 searches.

| Item | Assumption | Per month |
| --- | --- | --- |
| Web searches in daily runs | 10 searches × 30 runs | $3.00 |
| Haiku 5.5 tokens in daily runs | 300K input + 30K output per run | $1.35 |
| Tailoring with Sonnet 5.5 | 20 roles, 10K input + 5K output each | $1.40 |
| Company snapshots | 20 roles, 3 searches each, plus Haiku tokens | $0.70 |
| Reading pasted emails | 40 emails, 2K input + 400 output Sonnet 5.5 tokens each, with a suggested reply | $0.30 |
| Form answers (Phase 6) | 10 forms with their own questions, Sonnet 5.5 answers and the claim check | $0.30 |

Guardrails:

- **Budget caps.** A monthly cap (`MONTHLY_BUDGET_USD`, $20 by default) is checked against the `llm_call` table before every call. A run that reaches its own cap (`RUN_BUDGET_USD`, $1, not shown in Settings) stops cleanly and records why. Each automatic kit is counted at about $0.10 against what's left of the monthly budget before it starts.
- **Hard limits on tools and runs.** Every web search tool has `max_uses`. Extraction runs at most 5 postings at a time. The run function has an Inngest concurrency limit of 1, so two runs never overlap.
- **A second stop.** Set a monthly spend limit on the app's own workspace in the Claude Console. The Default Workspace can't have one ([workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces)).
- **Tests never call the live Claude API.** Use recorded responses in `test/fixtures/`.

## Phases

Run one phase per session with `/phase <n>`, and `/clear` between phases. Each phase is done only when every check below passes, with evidence.

### Phase 0: Foundation

What gets built:

- the dependencies above;
- `package.json` scripts:
    - `typecheck` (`next typegen && tsc --noEmit`; plain `tsc` misses the generated route types)
    - `test` (`vitest run --passWithNoTests`)
    - `format`
    - `db:generate`
    - `db:migrate`
- the `NEXT_OUTPUT` switch in `next.config.ts`;
- additions to `.gitignore`: `!.env.example`, `.data/`, `.claude/.done-check-*`;
- `pnpm dlx shadcn@latest init`;
- the Drizzle config, the ten app tables, and the generated Better Auth tables;
- one-account Better Auth: a `databaseHooks.user.create.before` hook that allows only the first sign-up, with the setup code. Don't use `disableSignUp`, which would block the first account too;
- `lib/dal` with `getCurrentUser`;
- the Inngest client and `/api/inngest`;
- the storage module;
- the app shell with a sign-in page.

Done when:

- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm test` pass
- [ ] `pnpm db:migrate` creates the ten app tables and the auth tables in the Compose database
- [ ] When the owner is signed out, every page redirects to `/sign-in`, sign-up needs the setup code, and a second account can't be created
- [ ] A test proves the data access layer throws when there's no session
- [ ] `docker compose --profile app up --build` serves the sign-in page on port 3000

### Phase 1: Profile

What gets built:

- CV upload, through a Route Handler;
- step 1 of the pipeline;
- the review form, using `useFieldArray` for roles and projects;
- saving with a snapshot;
- preferences and standard answers.

Done when:

- [ ] Uploading the owner's current CV fills the form with every role, project and skill in it
- [ ] Saving creates a `profile_snapshot`, and invalid fields show the Server Action's errors
- [ ] The parse call appears in `llm_call` with its cost
- [ ] Tests cover the profile schema and the save action, using a recorded Claude response

### Phase 2: Discovery and scoring

What gets built:

- steps 2–6 of the pipeline;
- the daily cron and the Search now button;
- the run page, which polls for progress;
- the budget caps.

Done when:

- [ ] One run stores at least 10 postings. Each has its facts, an eligibility verdict that quotes the location rule, and a score with reasons
- [ ] A second run adds no duplicates of the same postings
- [ ] The eligibility tests pass on sample postings: "US only" is not eligible, "EU only" is not eligible, "Europe" is eligible, "CET ±2" is eligible, and a posting that says nothing is unclear
- [ ] The run page shows live progress and stops polling when the run ends
- [ ] A run stops at `RUN_BUDGET_USD` and records why

### Phase 3: Inbox and tracker

What gets built:

- `/inbox` for sorting new matches;
- `/jobs`: TanStack Table v9 in manual mode, with nuqs URL state, column visibility and optimistic status changes;
- the detail drawer, notes and follow-up dates.

Done when:

- [ ] Filters, sort and page survive a reload and back/forward
- [ ] With 500 seeded jobs, paging, sorting and filtering run in SQL. A test covers the query builder
- [ ] A status change shows instantly, is saved, and adds a timeline event
- [ ] Shortlist, Skip and Not eligible each record a reason

### Phase 4: Tailoring and apply kit

What gets built:

- steps 7–10 of the pipeline;
- the diff view;
- regenerating one section;
- the apply kit;
- Mark as applied.

Done when:

- [ ] Tailoring a shortlisted role produces a CV PDF, a cover letter and answers, and moves the role to Ready
- [ ] A test checks that every bullet cites a real profile fact id, and a fake claim planted in a sample gets flagged
- [ ] The apply kit shows the posting's rule on AI use, if it has one
- [ ] The kit's CV shows the posting's keywords, marked on the CV, only in the profile, or missing
- [ ] Mark as applied stores the exact document versions and sets a follow-up 7 days later

### Phase 5: Polish

What gets built:

- the run history and spend view;
- Settings: models per step, caps, search domains, daily run on or off;
- empty and error states;
- a keyboard and screen-reader pass;
- a full Docker smoke test.

Done when:

- [ ] The monthly cap blocks new runs with a clear message
- [ ] A smoke script goes from sign-in through search (with recorded Claude responses), shortlist and tailoring to Mark as applied, against `docker compose --profile app`
- [ ] Changes in Settings apply to the next run

### Phase 6: Email replies and form filler (after v1)

The owner asked for both after using v1: the app reads employers' replies and moves the role on by itself, and fills application forms. Fully automatic submission stays out: applicant tracking systems keep their APIs for employers, and their forms check for bots. Reading Outlook was built first and then replaced by pasted emails, below, before it was ever connected.

What gets built:

- the form filler: a Chrome extension (Load unpacked, downloaded from Settings with the app's address written in) that reads the form, asks the app what goes where, fills contact details, links, standard and tailored answers and the cover letter, attaches the PDFs, and outlines what's left. Questions nothing answers go to Claude as an answers-only tailoring with the form's own wording and choices. When the owner submits, the role moves to Applied.

Done when:

- [ ] The extension fills a Greenhouse and a Lever form (one inside an iframe), attaches the CV, leaves salary and gender alone, and marks the role Applied after the owner submits

### After v1: Simpler app

The owner found v1 too busy: many forms, many buttons and a lot to decide. This round makes the app run by itself and turns the screens into things to read.

What gets built:

- auto-pick after each search: roles scoring 75 or more, at most 3 kits a day in the owner's time zone, and only while the monthly budget has about $0.10 a kit left. The rest of the strong roles wait for a free slot, and the weaker new roles are passed over;
- the Overview replaces Today and the inbox, with no inputs;
- Roles: a read-only list with tabs, replacing the tracker table and its drawer;
- the role page: the kit, one-click Mark as applied, a small status menu, and Prepare kit for a role the app didn't pick. Notes, follow-up dates, reasons and Regenerate are gone from the screens;
- a new CV saves itself into the profile, replacing it, and Profile becomes a summary with Edit links;
- Settings: the daily search switch, the monthly budget, Phase 6's form filler card, and the theme. Models, search domains and the per-run cap are fixed in code;
- the menu: Overview, Roles, Profile and Settings (Applications joined later, with pasted emails). Runs and Search now are one click away through the sidebar's run card. No command menu.

Done when:

- [ ] A search whose best match scores 75 or more ends with that role's kit being written, with no click
- [ ] The Overview and Roles have no form fields, and each KPI card links to the roles or runs behind it
- [ ] Uploading a CV replaces the profile and saves a snapshot, with nothing to review
- [ ] The smoke test goes from sign-in and CV upload through a search to an automatic kit and Mark as applied

### After v1: Pasted emails

The owner chose to paste employers' emails instead of letting the app read Outlook, and to handle the back-and-forth themselves with a reply drafted for each email. The agents find the roles and write the kits; the owner sends them and answers the companies.

What gets built:

- one box to paste an email in, on the Applications page and on each applied role's page. Claude reads it in an Inngest step (step 11), with the earlier emails on that role and the replies it suggested for them. On the Applications page code first narrows the applications to the companies the email names, and when Claude can't tell, the owner picks the role and Claude reads it again;
- the code rules from Phase 6 apply the outcome: a role only moves forward, a rejection closes it, an interview invite or a task moves it to Interviewing, an offer to Offer, and an unsure reading changes nothing. The email's card says what moved, with Undo;
- each email's card: what kind of email it is, a summary, key points with dates and times in full, and a suggested reply in the email's language, under 150 words, with square-bracket placeholders for what only the owner knows. Copying the reply marks it replied; Mark as replied covers one written another way;
- Your turn: an open application whose latest email from the company waits for an answer the owner hasn't sent. It shows on the Overview, as a count on the Applications menu item and as a filter;
- the Applications page: every role applied to, newest activity first, filtered by Your turn, Waiting on them, Interviewing, Offers and Closed, searched by company or role, and limited by when the owner applied. Roles keeps only To send, Waiting, Passed over and All;
- a daily sweep at 07:30 moves roles to No response after 30 days with no email from the company;
- Outlook goes: Connect Outlook, the 15-minute mail check, the Microsoft sign-in and the `mail_account` and `mail_message` tables.

Done when:

- [ ] An interview invite pasted into an applied role moves it to Interviewing, and the card shows the summary and a reply to copy
- [ ] A rejection closes the role, and an email Claude isn't sure about changes nothing
- [ ] An email pasted on the Applications page lands on the role it names, or asks which role it's about
- [ ] Copying the reply takes the role off Your turn
- [ ] The smoke test pastes an email after Mark as applied and sees the role move to Interviewing with a reply ready

### After v1: Top bar and Roles filters

The owner found the bar above each page empty and asked for something useful there, and for filters on Roles, new job postings among them.

What gets built:

- the top bar, on every page: how the daily search is doing (on and when it runs next, searching with its progress, off, paused by the budget, waiting for setup, or failed) with today's kits out of 3; how many roles were found since the owner last opened Roles; and the one thing that needs them next, a company waiting for a reply before a kit ready to send. On a phone it keeps the search's state and the count, and the tab bar's counts say the rest. While a search runs, the bar follows it and refreshes the page when it ends;
- new since your last visit: the browser keeps the owner's visits to Roles in a cookie, so nothing is written to the database. A visit ends after 30 minutes away, and the first one counts the past day;
- Roles' quick filters, kept in the URL with the tab: New (with its count), Score 75+ and Salary listed, plus an order for each tab (Ready first, Best match, Newest). New roles carry a badge, and rows show the salary when the posting gives one. There's no search box, so Roles still has no form fields;
- the Overview's line about the next search moves to the top bar.

Done when:

- [ ] Every page's top bar shows the search's state, and a running search's progress until it ends
- [ ] Opening Roles clears the top bar's count, and New lists the roles found since the visit before
- [ ] Roles' filters and order survive a reload and back/forward
- [ ] The top bar's Reply to or Apply to opens the role that's next

### After v1: PDF viewer

The owner asked to read documents inside the app, with a viewer that's safe, instead of downloading each one.

What gets built:

- View PDF next to Download PDF on the apply kit's CV and cover letter tabs, and View on the profile's CV card when the uploaded CV is a PDF. A Word CV gets Download, since the viewer shows only PDFs;
- the viewer: a window over the page, the whole screen on a phone, with the pages, the page count, zoom out and in, fit to width, and Download. Nothing in it can be edited or filled in;
- PDF.js, in its legacy build so browsers a few versions old work too, loaded only when a PDF is opened. Its worker is bundled with the app. Its styles sit in the `components` cascade layer, so the app's theme and Tailwind's utilities still win;
- the viewer reads the file through a `queryOptions` factory from the existing Route Handlers, so a PDF opened twice is fetched once. A new Route Handler, `GET /api/profile/cv/[id]/file`, sends the uploaded CV as it was uploaded, PDF or DOCX, after the session check.

Done when:

- [ ] View PDF on a kit's CV and cover letter shows the PDF's pages in the app, with the page count, zoom and Download
- [ ] The profile's CV card opens a PDF CV in the viewer and downloads a Word CV
- [ ] Links in a PDF open in a new tab, and JavaScript in a PDF never runs
- [ ] A missing or broken file shows a message instead of an empty window
- [ ] The smoke test opens the uploaded CV and the tailored CV in the viewer

### After v1: Application page

The owner asked for each applied role to have a page of its own, reached from Applications and Roles, that shows how the back-and-forth with the company is going. Of three layouts, they picked a page of its own built around the conversation.

What gets built:

- `/applications/[id]` for every role applied to. A role not applied to yet opens its kit at `/jobs/[id]` instead, and the kit links back to the application once it's sent. Every list opens an applied role here: the Overview, Roles, Applications, the top bar's Reply to and a filed email;
- how far it got: Applied, They replied, Interviewing and Offer, each with its date, or the step where it closed (Not going ahead, No response or Withdrawn);
- what's next, in one card at the top: the reply a company is waiting for, ready to copy (copying counts as replied, with Undo); an offer; waiting on them, with what's coming up from their last email and the day the 30-day sweep would close the role; or why it closed;
- the conversation, oldest first: the application, each pasted email folded into a line, and the status changes the emails made. The newest email is open unless the card at the top already shows it. The box to paste the next email ends it;
- beside it: what was sent (the CV's PDF, and the cover letter and answers to read again), the company brief and who there wrote, and the role at a glance;
- Mark as applied opens the new page, and the kit page no longer shows an applied role's emails.

No new table, Claude call or environment variable: the page reads the role, its kit and its emails through the queries the kit page already uses.

Done when:

- [ ] Every applied role in Applications, Roles, the Overview and the top bar opens `/applications/[id]`, and a role not applied to opens its kit
- [ ] A role waiting for the owner's reply shows it at the top, and copying it moves the page to Waiting on them, with Undo
- [ ] The conversation lists the application, every email and the status changes in order, on a phone too
- [ ] The smoke test's Mark as applied lands on the application page, and the pasted email's reply is ready at the top

### After v1: CV builder

The owner asked for a CV builder: a form to fill in that builds a new CV to current best practice, as attractive as possible to employers and easy for applicant tracking systems (ATS) to read, and a place where every CV made is saved to view again.

What gets built:

- a CVs page in the menu (under More on a phone): the CVs built with the builder, then the CVs tailored for a role, newest first. A built CV opens its own page; a tailored one opens in the viewer or opens its role (its application once applied);
- the builder, at `/cvs/new`: a short form filled in from the profile, so building can be one click. The job title starts as the profile's headline, the skills to lead with as the stack in the job preferences, the sections as the ones the profile has, and the length as two pages for four roles or more. A pasted posting aims the CV at it. A skill typed in that the profile doesn't have is added to the profile, so the CV can cite it. Build another like this starts the form from an earlier CV;
- step 12, Build a CV, in an Inngest function: Sonnet 5.5 writes the CV from the profile's facts, citing them, to current practice (a 2 or 3 sentence summary aimed at the title with no clichés, action verbs, exact numbers, the posting's own words where a fact backs them). The citation check and Claude's claim check from steps 9 and 10 follow, then the PDF, drawn again with fewer older bullets until it fits one or two pages;
- one CV template for built and tailored CVs: one column, standard headings in reading order, contact details in the body, skills by category, each role's technologies, page numbers on a second page, and the PDF's title, author and keywords set;
- each built CV's page: the PDF in the app's viewer, the ATS check (layout, pages and what was left out to fit, claims, and which of the posting's keywords the CV uses, which only the profile has and which the profile lacks), and what was asked for. It follows the build while Claude writes it.

Done when:

- [ ] The builder opens filled in from the profile, and Build CV with nothing changed makes a CV
- [ ] A built CV says nothing the profile doesn't: planted claims are left out of its PDF and listed on its page
- [ ] A pasted posting's keywords show on the CV's page, marked on the CV, only in the profile, or missing
- [ ] A one-page CV is one page, with what was left out to fit counted
- [ ] Every built and tailored CV is listed on the CVs page and opens in the viewer
- [ ] The smoke test builds a CV aimed at a posting and finds it on the CVs page

### After v1: CV cards and the CV editor

The owner asked for the CVs page to show their general CVs (like the one they uploaded) and the ones tailored for a role on separate tabs, as cards whose content they can see, the way a file browser shows documents, and to make a new CV by editing one: adding and removing things, from the information in their profile.

What gets built:

- the CVs page as two tabs, General and Tailored for a job, each a grid of cards. A card shows the CV's first page drawn from its PDF, its name, what it is and its date, and a menu. General holds the uploaded CV (a PDF opens in the viewer, a DOCX downloads) and every CV built or edited on the CVs page; Tailored holds every CV tailored for a role, each version on its own card. Clicking a card opens it. The tab is kept in the address, so a link can open either one;
- the editor, at `/cvs/edit`: the CV laid out as a page, with the title under the name, the summary, each role and project with its lines, the skills, and the whole sections (education, certifications, languages). The owner hides a role, removes, reorders or adds back any line from the profile, removes or adds skills, rewords the title and the summary, and picks one or two pages. A line is saved as a reference to text the CV or the profile holds, never as typed text, so every line still comes from the profile. New CV starts with everything in the profile, as the uploaded CV had it; Edit on a card starts from that CV;
- saving makes a new CV and keeps the original. A CV on the General tab saves as a new General CV. A role's tailored CV saves as the kit's next version while the role isn't applied to yet, and as a new General CV after. Saving asks Claude nothing: only its PDF is drawn, by the same Inngest functions, and the kit and the CV's page say it was edited by the owner;
- a General CV can be deleted, with its PDF. The uploaded CV and tailored CVs stay.

Done when:

- [ ] The CVs page shows General and Tailored for a job as tabs of cards with each CV's first page, on a phone too
- [ ] New CV starts with everything in the profile, and a saved edit has only the lines kept, in the order chosen
- [ ] An edit can't add a line the profile doesn't have, and lines Claude's check flagged can't be added back
- [ ] Editing a kit's CV before applying makes its next version, sent with the application
- [ ] The smoke test edits a kit's CV and a built CV with no Claude call, and finds both on the CVs page

### After v1: Fresh roles first

The owner asked what would raise their chances of being hired, and chose fresh roles first: most replies come in a posting's first days. They also asked for frontend roles to come first, in any framework, and for frontend and everyday tools such as Vite or Docker never to count against a role. That's a scoring rule only: the profile and the CVs never gain a skill the owner doesn't list.

What gets built:

- each role's posting date (`posted_on`), from the employer's tracking system (Greenhouse, Lever, SmartRecruiters, Ashby, Workable or Recruitee), else the page's own job data (`datePosted`), else the page's words on when it went up, kept only when those words are on the page. The 06:30 listing check fills it in for roles that don't have one;
- the company board watch: at the start of each search, code reads the public job boards of up to 40 companies that already posted a role the owner can take, the most recent first, leaving out excluded companies. Up to 10 of their new developer postings are read first: frontend, then full-stack, then developer roles that don't name a focus. Junior, hybrid, on-site and backend or mobile roles, and postings more than 21 days old, are left out by their title and the board's own fields. No Claude call until a posting is read;
- the score says what each role mainly works on: frontend, full-stack, backend, mobile or other. A frontend role at the owner's seniority is a strong match whatever its framework: a framework the profile doesn't show is a gap, but that alone doesn't take the score below 80. Build tools, containers, Git, CI, package managers, test runners and design tools never count against a role. Mostly backend, data, DevOps or native mobile roles, and roles below the owner's seniority, score lower;
- the kit order: among roles scoring 75 or more, frontend roles first, then full-stack, then the rest; within each, the newest postings first (an undated one counts as a week old), then the best score. A posting more than 21 days old is passed over, with its age as the reason, and Prepare kit still works on it;
- Next up and the Waiting tab list roles in that order (Next for a kit), Newest sorts by the day a posting went up, and rows and the role page say how long ago each role was posted;
- the searches ask for postings from the last 14 days, frontend roles first;
- when this ships, roles the app passed over for their score in the last 21 days go back to Waiting, and the next search scores them again.

Done when:

- [ ] A role on a Greenhouse, Lever, SmartRecruiters, Ashby, Workable or Recruitee board gets the day it was posted, and so does a page with `datePosted`
- [ ] A search reads new frontend postings on the boards of companies it already found, before the search results
- [ ] A frontend role at the owner's seniority in a framework the profile doesn't show scores 80 or more, and Vite or Docker in a posting is never a gap
- [ ] With more strong roles than the day's kits, frontend roles get them first, then the newest, and a posting more than 21 days old is passed over
- [ ] Rows, Next up and the role page show how long ago each role was posted

### After v1: Agents on your own plan

The owner asked to choose what the agents run on: the Claude API, Claude Code, or Codex. Claude Code signs in with the owner's Claude Pro or Max plan, and Codex with their ChatGPT plan, so their steps cost nothing against the monthly budget.

What gets built:

- Settings: an "Agents run on" card with Claude API (the default), Claude Code and Codex, each with whether it's signed in, the one-time sign-in steps, when it last ran a step, and why a step last ran on the API instead;
- Claude Code signs in with `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, set as a Sensitive Production variable in Vercel. Codex signs in with an auth.json from `codex login` in a folder of its own (`CODEX_HOME`), pasted in Settings and kept encrypted. Codex renews the tokens in that file as it runs, so the app keeps the renewed copy and lets one step use it at a time, as OpenAI asks for CI runners ([CI/CD auth](https://learn.chatgpt.com/docs/auth/ci-cd-auth));
- every step that calls Claude (steps 1, 2, 4, 6, 7, 8, 9, 11, 12 and the form filler's answers) goes through one adapter (`lib/claude/send.ts`). On a command-line engine each step starts a Vercel Sandbox with the CLI in it (the universal image has both), reaching only that agent's servers, and runs the step's own system prompt, prompt and JSON Schema one-shot (`claude -p --json-schema`, `codex exec --output-schema`). The answer goes through the same Zod schema as an API answer;
- step 4 on a command-line engine: the app fetches the page itself and sends its text, with the posting's JSON-LD facts first, since the agent has no web fetch. Step 1 with a PDF sends its text, read with PDF.js, and skips the Files API upload. Step 6 scores four postings per sandbox instead of the Message Batches API;
- any step the agent can't answer (no sign-in, the plan's limit, a refused sign-in, Codex busy, the sandbox failing, a page the app can't fetch, a PDF with no text, or an answer that doesn't match the schema) runs on the Claude API within the budget, and Settings keeps the latest reason with its time. A budget of $0 keeps every step off the API;
- steps on Claude Code or Codex are logged to `llm_call` with their engine and tokens at $0, and the budget checks skip them. Codex runs with the plan's own OpenAI model;
- on Codex, postings are read one at a time, since its sign-in serves one step at a time.

Done when:

- [ ] Settings switches between the three, shows each one's sign-in, and keeps the choice
- [ ] With Claude Code picked and signed in, a search, a kit, a CV read, a built CV and an email reading run with no Claude API call, and their `llm_call` rows cost $0
- [ ] A step whose agent fails runs on the API, within the budget, and Settings says why
- [ ] Codex's sign-in is stored encrypted, renewed copies are kept, and two steps never use it at once

### After v1: The OpenAI API

The owner asked to also choose the OpenAI API, and to see the choices as cards with a description each.

What gets built:

- Settings: the "Agents run on" choices become four cards (Claude API, Claude Code, Codex, OpenAI API), each saying what it is, how its steps are paid for, and whether it's set up. The OpenAI API card takes an API key, checked with OpenAI's free model list when it's saved (a key OpenAI calls wrong isn't kept) and stored encrypted like Codex's sign-in;
- on the OpenAI API, each step goes through the same adapter and sends the same instructions, prompt and JSON Schema as a command-line agent gets, to the Responses API with strict structured output, `store: false`, and web search capped at the step's search count. GPT-6.1 Sol stands in for Sonnet 5.5 and GPT-6 Luna for Haiku 5.5, at the same prices ([pricing](https://developers.openai.com/api/docs/pricing));
- its calls are paid, so each one is checked against the monthly and per-run budget first, and logged to `llm_call` with engine `openai_api`, the stand-in model and its cost, cache writes and cached reads included;
- steps 1 and 4 work as on a command-line engine (the PDF's text, the page the app fetched), and step 6 scores four postings per step instead of the batch;
- any step OpenAI can't answer (no key, a refused key, no credit, a rate limit, a cut-off or refused answer, or one that doesn't match the schema) runs on the Claude API within the budget, and Settings keeps the latest reason with its time.

Done when:

- [ ] Settings shows the four choices as cards with a description each, and keeps the choice
- [ ] With the OpenAI API picked and a key saved, the steps run on OpenAI, within the budget, and their `llm_call` rows carry OpenAI's model and cost
- [ ] A key OpenAI refuses isn't saved, and a step OpenAI can't answer runs on the Claude API, with the reason in Settings

### After v1: Your plan first, API keys optional

The owner asked for Claude Code or Codex to be the main way to run the agents, with the APIs second, and for the OpenAI API key to be part of setup too.

What gets built:

- setup (`scripts/setup.mjs`) asks what the agents run on, plans first: Claude Code (pastes the `claude setup-token` token), Codex (signed in from Settings), the Claude API or the OpenAI API (pastes the key). With a plan picked it offers one optional API key for steps the plan can't run, told apart by its prefix. It writes `AGENT_ENGINE`, which the app uses until Settings is saved; without it the app picks the first engine its environment has a sign-in for, a plan first;
- off Vercel, Claude Code and Codex run in the app's own container (the Docker image installs pinned versions of both): each step gets a new empty folder as its home and working folder, removed afterwards, and an environment with only `PATH`, the locale, a proxy and its certificates, and the agent's own sign-in. On Vercel they still run in a Vercel Sandbox;
- the Claude API key is optional. A step a plan's agent can't run goes to the Claude API when the app has its key, else to the OpenAI API when it has that one (saved in Settings, or `OPENAI_API_KEY`), else it stops with a reason, like a reached budget: a search says how many postings wait to be scored;
- Settings lists the plans first, says which keys the app has, where the agents run, and where a step goes when the plan can't run it.

Done when:

- [ ] A fresh copy set up with Claude Code and no API key runs a search, a CV read and a kit on the plan, in Docker, with every `llm_call` row at $0
- [ ] With Codex and only an OpenAI key, a step Codex can't answer runs on the OpenAI API, logged at its cost
- [ ] With a plan and no key, a step the plan can't run stops with a reason that says so, and nothing is retried

### After v1: Ready for anyone to run

The owner asked for the repository to be ready to open source, so anyone can run their own copy. The rules that were the owner's own become settings, and the repository gets what a public project needs.

What gets built:

- the owner's time zone sets when the daily runs start and when a day turns over; UTC until it's saved. It began as `TIME_ZONE` in `.env` and moved into the app (see "Time zone from the browser, setup in one command" below);
- job preferences gain "Roles you want most": any kind, frontend, full-stack, backend or mobile. The searches ask for that kind first, the score treats it as strong whatever its framework (frontend keeps the 80 floor), and kits, Next up and the company board watch put it first, then the kinds near it. A copy that saved its preferences before keeps frontend first; a new one starts with any kind;
- the board watch reads junior roles when the preferences ask for juniors or name no seniority;
- an MIT licence, a security policy, contributor notes and a GitHub Actions workflow that runs the typecheck, lint, tests and build on every pull request, with Dependabot for dependencies;
- `scripts/export-public.mjs`, which copies the committed tree into a new folder as a single fresh commit, with no history, for a new public repository.

Done when:

- [ ] A copy with its time zone set to America/New_York searches at 07:00 New York time, and Settings says so
- [ ] With Backend picked, a search asks for backend roles first, and kits go to backend roles first
- [ ] The workflow passes on a pull request, and the exported copy has one commit and no `.env`

### After v1: First-run setup in the app

The owner asked for a fresh copy to lead its owner through setup once, in the app: create the account once and sign in after that, choose the AI provider (required) and check it works, give the CV by uploading it or by filling in a form the agent turns into a professional, ATS-friendly CV, and only then open the app. It must not break a copy already in use.

What gets built:

- `/setup`, five steps with a stepper (Account, AI provider, Your CV, What you want, Ready). Creating the account opens it. Until setup is done, every page in the `(app)` layout sends there, and the daily search doesn't run; once it's done, `/setup` sends to the app. A migration marks a copy that already has a profile as set up, so it never sees the steps;
- what setup has done lives in the database (a one-row `setup` table, `engine_check` rows, settings, the profile and preferences), read by `GET /api/setup` with TanStack Query. A reload, another tab or another device picks up where setup was, the page polls every 2 s only while a check, a CV read or a CV build runs, Back always works, and a step ahead can't be skipped to. The profile form's draft is the one thing kept in the browser, until it's saved;
- AI provider: the four cards from Settings, none picked until the owner picks one. Connecting works as in Settings, and the Claude API key can now be pasted too: checked with the Claude API's free model list (a key it calls wrong isn't kept), stored encrypted, and used over `ANTHROPIC_API_KEY`. The Claude Code token still comes only from the environment. "Check it works" runs one tiny structured call on that engine in an Inngest step, made the way the agents make theirs and never falling back to another engine, logged to `llm_call` as stage `check_engine`. It starts by itself once the provider is connected, shows three ticks (signed in or key found, the background worker picked it up, the answer), and on a failure says why and what to do, with Check again and Pick another. A check not finished after 5 minutes counts as lost. Continue opens once the latest check passed after the sign-in or key was last saved. Settings gets the same check;
- Your CV, upload: PDF or Word up to 4 MB, read by step 1. Setup shows what it found, with Fix something (the profile form, in five parts) and an optional ATS-friendly CV in one click, written by step 12. A new upload asks before it replaces the profile;
- Your CV, form: everything a CV has, in five parts, each checked before the next. Saving starts the ATS-friendly CV, every line traced to the profile. Looks right opens once it's ready and written from the profile as it is now; if it fails, Try again or Continue without it;
- What you want: one question at a time with shadcn's Questionnaire (kind of role, levels, countries, time zones, stack), each answered from the CV (headline, location, skills) and the browser's time zone. The answers save as job preferences with remote only on; salary floor and companies to skip stay optional on Preferences;
- Ready: what setup saved, each with Change, the daily search on or off, then Start my first search or Open the app. A search that can't start says why, and setup still finishes.

Done when:

- [ ] A new copy goes from Create your account to setup, and no app page opens until setup is done
- [ ] Each provider's check passes, or says why it failed and what to do; a Claude API key the API refuses isn't saved
- [ ] An upload and the form both end with a profile the agents can use, and the form with an ATS-friendly CV
- [ ] A reload or a second tab opens the same step with the same answers, and a copy already in use updates without seeing setup

### After v1: Time zone from the browser, setup in one command

The owner asked for the time zone to come from the owner's computer by itself and change in Settings, and for setup to do everything, Docker included: clone the repository, run setup once, and nothing else.

What gets built:

- the owner's time zone lives in the database (`setup.time_zone`), not in `.env`. Finishing setup saves the browser's, which the Ready step shows and can change, and Settings has a time zone picker in the Daily search card, grouped by region, with this computer's marked and a "Use it" button when it differs from the saved one. A name the database doesn't know is refused with a message, since the lists and day counts ask Postgres for days in that time zone. A migration gives a copy already set up Europe/Belgrade, the time zone it had in code, so its runs don't move;
- the morning runs (listing check, daily search, no-reply check) are scheduled ahead, every 6 hours and whenever the time zone is saved, at their times in the saved time zone, so a change applies from the next morning without the database being asked every half hour. Everything that counts days (posting age, follow-ups, kits started today, the letter's date, the greeting) uses the saved time zone too;
- `node scripts/setup.mjs` sets up and starts a copy in one go: it checks Docker and Compose (starting Docker Desktop on Windows and macOS when it's installed but not running), writes `.env` with fresh secrets, asks what the agents run on (suggesting the plan whose agent is installed, and running `claude setup-token` for Claude Code), picks free ports when 3000, 5432 or 8288 are taken, gives a new copy its own compose project when an earlier copy's database is still in Docker, builds and starts the app, waits for it, and opens the sign-in page with the setup code after `#`, which the form fills in and takes out of the address bar. Run again, it keeps `.env` and rebuilds and restarts the app. `--no-start` only writes `.env`, for `pnpm dev`, and `docker compose run --rm setup` still writes `.env` without Node on the computer.

Done when:

- [ ] A fresh clone and `node scripts/setup.mjs` end with the sign-in page open in the browser, the setup code filled in, and the app running in Docker
- [ ] Finishing setup in a browser set to America/New_York saves that time zone, Settings shows it, and the next daily search starts at 07:00 New York time
- [ ] A copy already set up keeps Europe/Belgrade after the update

### After v1: Board feeds and Add a role

The owner asked for researched ways to find more suitable roles, and picked the first two: reading remote job boards' own feeds, and adding a role by hand. Each board's terms were checked on 2026-11-05. Remotive's terms forbid sending its jobs to third-party sites and Arbeitnow lists mostly on-site roles in Germany, so neither is read.

What gets built:

- each search reads the feeds of Remote OK (its API), We Work Remotely (the front-end and full-stack RSS), Jobicy (its engineering jobs) and Himalayas (a search for the kind of role the owner wants and their first technology, near their country), with plain HTTP and no Claude call. Each feed is asked at most once an hour, as Jobicy asks; a search within the hour uses the postings kept from its last answer;
- developer roles by their title, open to the owner's country as far as the board says, not from an excluded company and posted in the last 21 days are kept. Up to 15 go in the reading list after the company boards, the kind of role wanted first, then the newest. The same company and title on two boards is read once;
- a feed's posting is read from the text the feed gave (step 4 with no tool), so its page isn't fetched. As the boards' terms ask, the role links to the board's page and applies through it (Himalayas gives an apply link), the links keep the referrer, and the role page says "Found on" the board. A board whose feed answered is left out of that run's site searches, which keep the same number of calls over the other sites;
- Add a role on the Roles page: the posting's link, and its text where apps can't read the page. A link on a site whose terms forbid apps, such as LinkedIn or Indeed, needs the text. In the background the posting is read (from the text when given), checked, stored as added by the owner and scored in one request. A role the owner can take, not from an excluded company, is picked with its kit whatever its score; the auto-pick never passes over an added role. A link the app already has isn't read again, and a role it passed over gets its kit. With no saved profile, or no budget left on the API, the role waits for Prepare kit. Roles you added, above the list, shows the last three from the past day: being read, the role each became with what came of it, or why it couldn't be added. The top bar refreshes the page when they're done.

Done when:

- [ ] A search reads new frontend postings from the four feeds, links to and applies through each board's page, and asks each feed at most once an hour
- [ ] A board whose feed answered isn't searched in that run, and one that didn't answer is searched as before
- [ ] Adding a LinkedIn link asks for the posting's text, and adding a readable link alone gives a scored role with its kit started
- [ ] Adding a role the app passed over gives it its kit, and adding one the owner can't take keeps it with the reason and no kit
