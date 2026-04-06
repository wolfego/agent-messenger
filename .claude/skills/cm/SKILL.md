---
name: cm
description: Check agent-messenger inbox for new messages. Use when the user says "check messages", "#cm", or asks about incoming messages from other agents.
disable-model-invocation: true
---

Check your agent-messenger inbox using the `check_inbox` MCP tool. If there are unread messages, read each one, act on any that have an `action` field (review, brainstorm, implement, reply), and mark them read. If the inbox is empty, just say "No new messages."
