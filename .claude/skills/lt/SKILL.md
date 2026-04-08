---
name: lt
description: List tasks. Use when the user says "/lt", "list tasks", or wants to see current work items.
disable-model-invocation: true
---

List tasks using the `list_tasks` MCP tool. Default to open tasks sorted by priority. If the user asks for specific filters (status, assignee, label), pass those along. Show a concise summary: ID, title, status, priority, assignee.
