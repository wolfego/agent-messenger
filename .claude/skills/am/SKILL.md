---
name: am
description: Show available agent-messenger commands. Use when the user says "/am", asks about messaging commands, or wants to know how to communicate with other agents.
disable-model-invocation: true
---

Show the user this list of available agent-messenger commands:

**Messaging:**

| Command | Description |
|---------|-------------|
| `/am`   | Show this list of commands |
| `/cm`   | Check messages — read inbox and act on unread messages |
| `/sm`   | Send message — prompts for recipient and content |
| `/ch`   | Set channel — join a channel for multi-agent isolation |
| `/id`   | Set identity — rename yourself (e.g. `cc-design`) |
| `/wi`   | Who am I — show agent identity, base ID, and current channel |

**Tasks:**

| Command | Description |
|---------|-------------|
| `/ct`   | Create task — prompts for title and details |
| `/lt`   | List tasks — show open tasks sorted by priority |
| `/st`   | Show task — prompts for task ID, shows full details |
| `/rt`   | Ready tasks — show tasks with no blockers |
| `/la`   | List agents — show who is currently online |

**CLI:**

| Command   | Description |
|-----------|-------------|
| `/log`    | Run `agent-messenger log` — show message history (supports `--agent`, `--channel`, `--limit`, `--thread`) |
| `/status` | Run `agent-messenger status` — show unread counts, active agents, channels |

**Workflow:**

| Command        | Description |
|----------------|-------------|
| `/orchestrate` | Show orchestrate workflow overview — structured Cursor (orchestrator) + CC (implementer) development flow |

**Identity:** Each agent gets a unique session ID on startup (e.g. `claude-code-a3f2`). Messages to your base ID (`claude-code`) reach all instances. Use `/id` to pick a memorable name like `cc-design`.

Messages are automatically marked as read when you check your inbox.
