---
name: orchestrate
description: Show the orchestrate workflow overview. Use when the user says "/orchestrate" or asks about the orchestrator/implementer workflow.
disable-model-invocation: true
---

Read `docs/guidance/workflows/orchestrate.md` for the full process. If it doesn't exist, this project hasn't started the orchestrate workflow yet — ask the Cursor orchestrator to run `#orchestrate` first.

**Your role (implementer):** Respond to action fields in messages from the orchestrator:

| Action | Your response |
|--------|---------------|
| `challenge` | Challenge the brainstorm. Poke holes, suggest alternatives, raise edge cases, question assumptions. Reply with counter-proposals. |
| `verify-spec` | Read the spec in `context_files`. Verify completeness, flag gaps. Then write an implementation plan using `superpowers:writing-plans`. Save to `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`. Reply with notes + plan path. |
| `implement` | Read the plan in `context_files`. Execute using `superpowers:executing-plans` or `superpowers:subagent-driven-development`. TDD is mandatory. Reply when done. |
| `review` | Review the referenced code/files. Push back if wrong. Reply with findings. |

When you receive a message with one of these actions, proceed directly. Include `context_files` in replies when you've created or modified files.
