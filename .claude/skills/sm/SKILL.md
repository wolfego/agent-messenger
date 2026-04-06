---
name: sm
description: Send a message to another agent via agent-messenger. Use when the user says "send message", "#sm", or wants to communicate with Cursor or another agent.
disable-model-invocation: true
---

Send a message to another agent using the `send_message` MCP tool. Ask the user who to send to (default: "cursor-opus") and what the message should contain. Include a clear subject, the action the recipient should take, and any relevant context_files.
