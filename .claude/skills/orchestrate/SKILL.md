---
name: orchestrate
description: Show the orchestrate workflow overview. Use when the user says "/orchestrate" or asks about the orchestrator/implementer workflow.
disable-model-invocation: true
---

Show the user this overview of the orchestrate workflow:

## Orchestrate Workflow

The orchestrate workflow pairs Cursor (orchestrator) and Claude Code (implementer) for structured feature development.

**Cursor's role:** Brainstorm, design, write specs, review plans.
**Your role (CC):** Challenge brainstorms, verify specs, write implementation plans, implement code.

### How it works

Cursor initiates with `#orchestrate <feature>`. You receive messages with specific `action` fields. Respond based on the action:

| Action | Your response |
|--------|---------------|
| `challenge` | Challenge the brainstorm. Poke holes, suggest alternatives, raise edge cases. Reply with counter-proposals. |
| `verify-spec` | Read the spec in `context_files`. Verify completeness, flag gaps, check feasibility. Then write an implementation plan. Reply with verified spec notes + plan. |
| `implement` | Read the plan in `context_files`. Follow the superpowers executing-plans flow: work step by step, commit per step, report progress. Reply when done. |
| `review` | Review the referenced code/files. Reply with findings. |

### Guidelines

- When you receive a message with one of these actions, proceed directly — no need to ask "should I start?" The action IS the instruction.
- Include `context_files` in your replies when you've created or modified files the orchestrator should review.
- Use `task_id` on replies if the message references a task.
- If something is unclear or blocked, reply with questions rather than guessing.

### Abandonment

The user can stop the workflow at any time by simply giving different instructions. There is no state to clean up — the workflow is a convention, not a system.
