---
name: cm
description: Check agent-messenger inbox for new messages. Use when the user says "check messages", "#cm", or asks about incoming messages from other agents.
disable-model-invocation: true
---

Check your agent-messenger inbox using the `check_inbox` MCP tool. If there are unread messages, read each one and act on any that have an `action` field (review, brainstorm, implement, reply). Messages are automatically marked read when fetched. If the inbox is empty, just say "No new messages."

If this is your first turn and you haven't set an identity yet, call `set_identity` with a short name reflecting your current task (e.g. `cc-web-ui`, `cc-auth-tests`). Derive the name from the user's first message or the task context.
