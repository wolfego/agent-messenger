---
name: orchestrate
description: Show the orchestrate workflow overview. Use when the user says "/orchestrate" or asks about the orchestrator/implementer workflow.
disable-model-invocation: true
---

Show the user this overview of the orchestrate workflow:

## Orchestrate Workflow

The orchestrate workflow pairs Cursor (orchestrator) and Claude Code (implementer) for structured feature development, built on the superpowers process.

**Cursor's role:** Brainstorm (using `superpowers:brainstorming`), write specs, review plans, review code.
**Your role (CC):** Challenge designs, verify specs, write plans (using `superpowers:writing-plans`), implement (using `superpowers:subagent-driven-development` or `superpowers:executing-plans`).

### How it works

Cursor initiates with `#orchestrate <feature>`. You receive messages with specific `action` fields. Respond based on the action:

| Action | Your response | Superpowers skill to use |
|--------|---------------|--------------------------|
| `challenge` | Challenge the brainstorm. Poke holes, suggest alternatives, raise edge cases, question assumptions. Reply with counter-proposals. | None — use your own critical analysis |
| `verify-spec` | Read the spec in `context_files`. Verify completeness, flag gaps, check feasibility. Then write an implementation plan using `superpowers:writing-plans` (bite-sized TDD steps, file structure, proper format). Save plan to `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`. Reply with verified spec notes + plan file path. | `superpowers:writing-plans` |
| `implement` | Read the plan in `context_files`. Use `superpowers:subagent-driven-development` if subagents are available (fresh subagent per task, two-stage review), otherwise `superpowers:executing-plans`. Both enforce TDD and verification. When complete, use `superpowers:finishing-a-development-branch`. Reply when done. | `superpowers:subagent-driven-development` or `superpowers:executing-plans`, then `superpowers:finishing-a-development-branch` |
| `review` | Review the referenced code/files. Use `superpowers:receiving-code-review` principles: verify before implementing, push back if wrong. Reply with findings. | `superpowers:receiving-code-review` |

### Cross-cutting requirements

These superpowers skills apply throughout implementation:
- **`superpowers:test-driven-development`** — TDD is mandatory. No production code without a failing test first.
- **`superpowers:verification-before-completion`** — No completion claims without fresh verification evidence. Run tests, read output, then claim.
- **`superpowers:using-git-worktrees`** — Set up isolated workspace before starting implementation.

### Guidelines

- When you receive a message with one of these actions, proceed directly — the action IS the instruction.
- Include `context_files` in your replies when you've created or modified files the orchestrator should review.
- Use `task_id` on replies if the message references a task.
- If something is unclear or blocked, reply with questions rather than guessing.

### Abandonment

The user can stop the workflow at any time by simply giving different instructions. There is no state to clean up — the workflow is a convention, not a system.
