# Contributing

Thanks for helping. Bug reports, fixes and small improvements are welcome. For a bigger change, open an issue first, so we can agree on it before you build it.

## What fits

Job Agent is a single-user app that each person runs for themselves. Changes that keep it that way fit; these don't:

- submitting applications, sending emails or answering employers by itself: the owner always presses Submit and Send;
- scraping sites whose terms forbid it (such as LinkedIn, Indeed or Glassdoor), or getting past bot checks and CAPTCHAs;
- tailored documents that claim anything the owner's profile doesn't back;
- one copy serving several people, or a hosted copy that signs in to one person's Claude or ChatGPT plan for others.

## Getting started

Follow [Working on the code](README.md#working-on-the-code) in the README: `pnpm install`, `node scripts/setup.mjs --no-start`, `docker compose --profile dev up -d`, `pnpm db:migrate`, `pnpm dev`. Read `AGENTS.md` before you change code: it has the folder layout and the architecture rules, and `SPEC.md` has the why.

## Before you open a pull request

- `pnpm typecheck`, `pnpm lint` and `pnpm test` pass. GitHub Actions runs them and the build on every pull request.
- For a change to a page, `pnpm smoke` passes too (see [Smoke test](README.md#smoke-test)).
- Tests never call a live API. Use the recorded responses in `test/fixtures/`, and record new ones there.
- For a change to how Codex runs, run the opt-in test that drives the real Codex CLI against a stand-in OpenAI server: `CODEX_E2E=1 pnpm vitest run lib/claude/cli/codex.e2e.test.ts`, with Codex on your PATH.
- New behaviour has a test, and the matching section of `SPEC.md` is up to date.
- After editing `db/schema.ts`, run `pnpm db:generate` and commit the migration it writes.
- Don't hand-write files in `components/ui/`: add components with `pnpm dlx shadcn@latest add <component>`.
- `package.json` scripts run in cmd.exe on Windows and sh elsewhere, so they can't use `VAR=x cmd` prefixes, single-quoted arguments or `rm -rf`.

Keep commits small, with conventional messages (`feat: ...`, `fix: ...`, `docs: ...`). Write UI text, prompts and comments in plain, short sentences.

## Licence

By contributing, you agree that your contribution is released under the [MIT licence](LICENSE).
