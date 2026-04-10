# agent-messenger

MCP server for AI agent-to-agent messaging. Lets Cursor and Claude Code agents send messages, reply in threads, and coordinate work — backed by [Beads](https://github.com/gastownhall/beads) for persistent, version-controlled storage.

## Quick Start

**Prerequisites:** [Node.js 18+](https://nodejs.org), [Beads (`bd` CLI)](https://github.com/gastownhall/beads/releases) v1.0.0+, [Dolt](https://docs.dolthub.com/introduction/installation) v1.85.0+

```bash
# Install
npm install -g agent-messenger

# Set up in your project
cd your-project
agent-messenger init

# Restart Cursor. Done.
```

That's it. The `init` command handles Beads initialization, MCP config generation, Cursor rules, and Claude Code skills. If something doesn't work, run:

```bash
agent-messenger doctor
```

## How It Works

Both agents connect to the same MCP server with different identities. Messages route via labels (`to:`, `from:`, `unread`) stored in a Beads (Dolt) database. Threading uses `replies_to` graph links. Channels isolate conversations when multiple agent pairs are active.

```
┌──────────────┐         ┌─────────────────────┐         ┌──────────────┐
│    Cursor     │◄─stdio─►│  agent-messenger MCP │◄─stdio─►│  Claude Code  │
│  cursor-opus  │         │                     │         │  claude-code  │
│               │         │  send_message       │         │               │
│ #cm #sm #id   │         │  check_inbox        │         │ /cm /sm /id   │
└──────────────┘         │  reply / get_thread  │         └──────────────┘
                          │  set_channel / ...   │
                          │                     │
                          │  ┌───────────────┐  │
                          │  │ Beads (bd CLI) │  │
                          │  │ .beads/ Dolt DB│  │
                          │  └───────────────┘  │
                          └─────────────────────┘
```

## Tools

**Messaging:**

| Tool                 | Description                                        |
| -------------------- | -------------------------------------------------- |
| `send_message`       | Send a message (supports `task_id` for linking)    |
| `check_inbox`        | Check for unread messages                          |
| `reply`              | Reply to a message (auto-threads, optional `task_id`) |
| `get_thread`         | Get full conversation thread                       |
| `list_conversations` | List all conversations                             |
| `mark_read`          | Mark a message as read                             |
| `set_channel`        | Join a channel for multi-agent isolation            |
| `set_identity`       | Rename this agent instance                         |
| `whoami`             | Show identity, base ID, and channel                |

**Tasks:**

| Tool           | Description                                             |
| -------------- | ------------------------------------------------------- |
| `create_task`  | Create a task in Beads                                  |
| `create_epic`  | Create an epic for phased planning                      |
| `list_tasks`   | List tasks with filters (status, priority, ready-only)  |
| `show_task`    | Show task details and linked messages                   |
| `update_task`  | Update status, notes, labels, priority, or assignee     |
| `claim_task`   | Atomically assign and start a task                      |
| `close_task`   | Close a completed task                                  |

**Discovery:**

| Tool           | Description                                 |
| -------------- | ------------------------------------------- |
| `list_agents`  | Show agents currently online                |

## Shortcuts

**Cursor** (via rules): `#help` `#cm` `#sm` `#ch` `#id` `#wi` `#ct` `#lt` `#st` `#rt` `#la` `#orchestrate`

**Claude Code** (via skills): `/am` `/cm` `/sm` `/ch` `/id` `/wi` `/ct` `/lt` `/st` `/rt` `/la` `/orchestrate`

## Identity & Multi-Agent

Each agent gets a unique session ID on startup (e.g. `claude-code-a3f2`). The base ID (`claude-code`) is shared across all instances — messages to the base ID reach every instance. Use `set_identity` (`#id` / `/id`) to pick a memorable name like `cc-design`.

When multiple agent windows/terminals are open in the same project, you have two options:

**Name them:** `#id cursor-design`, `/id cc-design` — then address by name

**Use channels:** `#ch design-review`, `/ch design-review` — only paired agents see messages

## CLI Commands

| Command                  | Description                                  |
| ------------------------ | -------------------------------------------- |
| `agent-messenger init`   | Set up agent-messenger in current project    |
| `agent-messenger doctor` | Diagnose common setup issues                 |
| `agent-messenger status` | Show unread counts, agents, and channels     |
| `agent-messenger log`    | View message history (filters, thread view)  |
| `agent-messenger help`   | Show help                                    |

### Init options

| Flag               | Default        | Description                       |
| ------------------ | -------------- | --------------------------------- |
| `--cursor-id <id>` | `cursor-opus`  | Cursor agent ID                   |
| `--cc-id <id>`     | `claude-code`  | Claude Code agent ID              |
| `--dry-run`        |                | Preview changes without writing   |
| `--skip-beads`     |                | Skip Beads/Dolt setup             |

## Manual Setup

If you prefer to set things up manually (or the installer doesn't cover your setup), see [docs/setup-guide.md](docs/setup-guide.md).

## License

MIT
