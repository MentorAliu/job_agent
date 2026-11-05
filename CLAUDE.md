@AGENTS.md

## Claude Code

- **MCP servers** (see `.mcp.json`; check with `/mcp`):
    - `next-devtools`: errors, routes and logs from the running dev server.
    - `shadcn`: browse and install components from the registry.
- **Skills:**
    - `next-dev-loop`: check every UI edit in the running app.
    - `shadcn`
    - The TanStack Table skills that ship in `node_modules`.
    - `/claude-api`: building on the Claude API.
    - `/phase <n>`: build one phase of `SPEC.md`.
- **Subagents** (in `.claude/agents/`):
    - `docs-checker`: before you use an API you haven't verified this session.
    - `spec-reviewer`: before you call a phase done.
- **Plan mode:** use it for any change that touches more than two files. Skip it for one-line fixes.
- **Stop hook:** typecheck, lint and tests run when you finish. If it reports failures, fix the cause. Don't silence the check.
- **When compacting,** keep the current phase number, the files changed so far, and any failing checks.
