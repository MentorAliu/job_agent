# Security

## Reporting a problem

Please report security problems privately, not in a public issue: on GitHub, open the repository's **Security** tab and press **Report a vulnerability**. Say what you found, how to reproduce it, and what it lets someone do.

Only the latest `main` is supported. There are no separate releases to patch.

## What the app protects

Each copy of Job Agent belongs to one person and holds their CV, their job search and their keys. The design keeps those to that person:

- **One account.** The first sign-up creates it, and only with the setup code derived from `BETTER_AUTH_SECRET`. After that, sign-up is closed for good. Every page and the app's own API routes need the session (the Inngest route checks Inngest's signature instead), and sign-in and sign-up are rate limited in the database.
- **Ports on this computer only.** In Docker, every port listens on `127.0.0.1`, so others on the same network can't reach the app.
- **Secrets stay out of the database in plain text.** Codex's sign-in and any Claude or OpenAI API key pasted in the app are encrypted with AES-256-GCM, with a key derived from `BETTER_AUTH_SECRET`. Keys put in `.env` and the Claude Code token live in `.env` or the host's environment variables, which are never committed (`.gitignore`).
- **No reaching inside.** The app fetches job pages and boards only from public websites: a link, or a redirect, to this computer, a private network or a cloud metadata address is never fetched. No other site can show the app in a frame, and the CV upload refuses a form posted from another site.
- **Agents in a box.** A command-line agent (Claude Code or Codex) runs each step in a new empty folder, removed afterwards, with none of the app's keys or files and no tool but web search. On Vercel it runs in a Vercel Sandbox that can reach only its own servers. Job postings, web pages and emails are treated as data, never as instructions, in every prompt.
- **Nothing is sent for you.** The app never submits an application, sends an email or reads a mailbox. The form filler fills a form and leaves Submit to you.
- **Spend is capped.** Every paid API call is checked against the monthly and per-run budget first, and logged with its cost.

## Keeping your copy safe

- Keep `.env` private, and back up `BETTER_AUTH_SECRET`: it signs sessions, makes the setup code and encrypts saved keys. Changing it signs you out and makes saved keys unreadable.
- Use a dedicated API key for the app, with a spend limit set at the provider.
- Don't share a copy signed in to your Claude or ChatGPT plan with anyone else.
- Keep the copy up to date: `git pull`, then rebuild.
