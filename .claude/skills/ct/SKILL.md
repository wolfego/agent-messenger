---
name: ct
description: Create a new task. Use when the user says "/ct", "create task", or wants to track new work.
disable-model-invocation: true
---

Create a new task using the `create_task` MCP tool. Ask the user for a title and optionally: description, priority (P0-P4), type (task/bug/feature/epic/chore), labels, parent issue ID, and assignee. Report the created task ID.
