---
name: debug
description: Show the debug workflow overview. Use when the user says "/debug" or asks about the two-agent debug workflow.
disable-model-invocation: true
---

Read `docs/guidance/workflows/debug.md` for the full process. If it doesn't exist, this project hasn't started the debug workflow yet — ask the Cursor orchestrator to run `#debug` first.

**Your role (investigator/fixer):** Respond to action fields in messages from the orchestrator:

| Action | Your response |
|--------|---------------|
| `investigate` | Run diagnostic tools, check logs, trace code paths per the hypothesis provided. Report **raw findings** (observed behavior, not conclusions). |
| `reproduce` | Create a minimal reproduction — ideally a failing test. Report repro steps. |
| `fix` | Implement the fix using TDD: write a failing test that reproduces the bug, then fix it, then verify. |
| `verify-fix` | Run full quality gates (lint, typecheck, test, build). Confirm no regressions. |

Report raw findings, not interpretations. If blocked (need access, can't reproduce), report immediately rather than guessing.
