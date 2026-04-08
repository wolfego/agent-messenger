---
name: rt
description: Show ready tasks (no blockers). Use when the user says "/rt", "ready tasks", or wants to know what to work on next.
disable-model-invocation: true
---

List ready tasks using the `list_tasks` MCP tool with `ready_only: true`. These are open tasks with no unresolved blockers. Show a concise summary: ID, title, priority, assignee.
