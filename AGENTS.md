<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Job Agent

Single-user app. Claude finds remote roles the owner is eligible for, scores them, and tailors a CV, cover letter and form answers for roles the owner shortlists. The owner submits applications. Full spec: `SPEC.md`. Read the current phase there before starting work.

## Commands

- `docker compose --profile dev up -d`: Postgres and the Inngest Dev Server (run once per session)
- `pnpm dev`: the Next.js dev server
- `pnpm typecheck`, `pnpm lint`, `pnpm test`: all three must pass before you finish. The Stop hook enforces it.
- `pnpm smoke`: the browser smoke test against its own Docker stack, with recorded Claude responses (see README)
- `pnpm db:generate` after editing `db/schema.ts`, then `pnpm db:migrate`
- `pnpm auth:generate` after changing Better Auth options in `lib/auth/options.ts`, then `pnpm db:generate`
- `docker compose --profile app up --build`: the full stack in Docker
- `pnpm dlx shadcn@latest add <component>`: add UI components. Never hand-write files in `components/ui/`.

## Docs first

Check the official docs for the installed version before using a library API. Read the version in `node_modules/<pkg>/package.json`. Ask the `docs-checker` subagent when unsure.

| Library | Version | Where to look |
| --- | --- | --- |
| Next.js | 16.4 | `node_modules/next/dist/docs/`, the next-devtools MCP |
| shadcn/ui | CLI 4.x | shadcn MCP, `pnpm dlx shadcn@latest docs <component>`, ui.shadcn.com/docs |
| Recharts, through shadcn Chart | 3.8 | ui.shadcn.com/docs/components/base/chart, recharts.github.io |
| TanStack Query / Table | 5 / 9 | tanstack.com/query/latest/docs, tanstack.com/table/latest/docs (add `.md` to any page) |
| React Hook Form / Zod | 7 / 4 | react-hook-form.com/docs, zod.dev |
| Drizzle ORM | 1.0 RC | orm.drizzle.team/docs |
| Better Auth | 1.7 | better-auth.com/docs |
| Inngest | SDK 4 | inngest.com/docs |
| nuqs | 2 | nuqs.dev/docs |
| Claude API | SDK 0.135 | platform.claude.com/docs, the `/claude-api` skill |
| PDF.js (`pdfjs-dist`) | 6.4 | mozilla.github.io/pdf.js, `node_modules/pdfjs-dist/types/` |

APIs that changed recently. Don't write these from memory:

- TanStack Table v9: `useTable` with `tableFeatures(...)`.
- TanStack Query: `environmentManager.isServer()` and `queryClient.query()`.
- Drizzle v1: `drizzle-orm/zod`.
- Next.js 16: `proxy.ts`, Cache Components and `refresh()`.
- Zod 4: `z.email()` and `z.flattenError()`.

## Architecture rules

- **Folders:**
    - `app/`: routes
    - `components/ui/`: shadcn, generated
    - `components/`: app components
    - `lib/dal/`: server-only data access with a session check
    - `lib/pipeline/`: server-only data access for Inngest steps, which run without a session
    - `lib/schemas/`: Zod schemas, the single source for forms, actions and Claude outputs
    - `lib/claude/`: prompts and API calls
    - `lib/mail/`: the code rules for employers' emails, which the owner pastes, and tidying and matching their text
    - `lib/extension/` and `extension/`: the form filler's app side and the Chrome extension itself
    - `db/schema.ts`: Drizzle tables
    - `inngest/`: background functions
- **Reads:** Server Components call `lib/dal/`. Client reads go through Route Handlers plus TanStack Query. Never use a Server Action as a `queryFn`.
    - Every query is a `queryOptions` factory (`lib/jobs/queries.ts`, `lib/run-polling.ts`).
    - When a Server Component provides a query's first data, it prefetches with `queryClient.query({ ...options, queryFn: () => dal() })` and wraps the Client Component in `<HydrationBoundary>`, which reads it with `useSuspenseQuery`. Never `initialData`.
- **Writes:** Server Action, then validate with Zod, then `lib/dal/`, then `refresh()` or a query invalidation. Server Actions return field errors with `z.flattenError`.
- **Long work** (search, scoring, tailoring, PDF rendering) runs only inside Inngest steps, never inside a request.
- **Claude calls** live only in `lib/claude/`. Use structured outputs with `zodOutputFormat`, and log every call to the `llm_call` table with its cost.
- **Tailored documents** must never contain a claim that isn't in the profile. Every bullet carries the id of the profile fact it comes from.
- **Tests** never call the live Claude API. Use recorded fixtures in `test/fixtures/`.

## Conventions

- **TypeScript:** strict, no `any`, named exports. Add `import "server-only"` in `lib/dal/` and `lib/claude/`.
- **Commits:** small, one Done-when item each, conventional messages. Push only your own `claude/*` branch (`git push -u origin claude/<name>`). Never push to main or force-push; those still ask the owner.
- **Cross-platform:** the app is developed on native Windows too. pnpm runs `package.json` scripts with cmd.exe there and with sh in Docker, so scripts can't use `VAR=x cmd` prefixes, single-quoted arguments or `rm -rf`.
