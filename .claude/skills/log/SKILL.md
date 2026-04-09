---
name: log
description: Show agent-messenger message history. Use when the user says "/log" or asks to see message history or recent messages.
disable-model-invocation: true
---

Run `agent-messenger log` in the shell and show the output to the user. This displays message history in chronological order.

The user may include flags inline, e.g. "/log --agent claude-code" or "/log --thread abc123". Supported flags:

- `--agent <id>` or `-a <id>` — filter by sender
- `--channel <ch>` or `-c <ch>` — filter by channel
- `--limit <n>` or `-n <n>` — number of messages (default: 20)
- `--thread <id>` or `-t <id>` — show a specific conversation thread
