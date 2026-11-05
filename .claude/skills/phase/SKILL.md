---
name: phase
description: Builds one phase of SPEC.md end to end, covering plan, implement, verify, review and commit. Use when the user runs /phase followed by a phase number.
disable-model-invocation: true
---

Build phase $ARGUMENTS of `SPEC.md`.

1. Read the phase in `SPEC.md`: its "What gets built" list and its "Done when" checks. Also read "Not in v1" in the Summary, which is out of scope for every phase. Re-read the rules in `AGENTS.md`.
2. Explore the code this phase touches. List the library APIs you plan to use, and ask the `docs-checker` subagent to confirm each one against the installed version.
3. Write a short plan covering the files you will change, the interfaces between them, and the tests that prove each Done-when item. Wait for my approval.
4. Implement in small steps.
    - After each step, run `pnpm typecheck` and the tests for that area.
    - For UI changes, use the `next-dev-loop` skill to check the page in the running app.
5. When every Done-when item passes, show the evidence: each command you ran and its output.
6. Ask the `spec-reviewer` subagent to review the diff against this phase. Fix every gap it reports that affects correctness.
7. Commit each logical change separately with a conventional commit message. Push only your own `claude/*` branch, never main.
