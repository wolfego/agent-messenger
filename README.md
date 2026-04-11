# agent-messenger

[![CI](https://github.com/wolfego/agent-messenger/actions/workflows/ci.yml/badge.svg)](https://github.com/wolfego/agent-messenger/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

MCP server for AI agent-to-agent messaging. Lets Cursor and Claude Code agents send messages, reply in threads, and coordinate work — backed by [Beads](https://github.com/steveyegge/beads) for persistent, version-controlled storage.

## Quick Start

**Prerequisites:** [Node.js 20+](https://nodejs.org), [Beads (`bd` CLI)](https://github.com/steveyegge/beads/releases) v1.0.0+, [Dolt](https://docs.dolthub.com/introduction/installation) v1.85.0+

```bash
# Install globally (the CLI command is "agent-messenger")
npm install -g cursor-claude-messenger

# Set up in your project
cd your-project
agent-messenger init

# Restart Cursor. Done.
```

> **Windows:** If `agent-messenger` isn't recognized after install, the npm global bin directory likely isn't in your PATH. Run `npm prefix -g` to find it (usually `C:\Users\<you>\AppData\Roaming\npm`), then add it permanently:
> ```powershell
> [Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";$(npm prefix -g)", "User")
> ```
> Restart your terminal after.

The `init` command handles Beads initialization, MCP config generation, Cursor rules, and Claude Code skills. If something doesn't work, run:

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

## Tools (22)

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

| Tool             | Description                                             |
| ---------------- | ------------------------------------------------------- |
| `create_task`    | Create a task in Beads                                  |
| `create_epic`    | Create an epic for phased planning                      |
| `list_tasks`     | List tasks with filters (status, priority, ready-only)  |
| `show_task`      | Show task details and linked messages                   |
| `update_task`    | Update status, notes, labels, priority, or assignee (smart-routes close/reopen) |
| `claim_task`     | Atomically assign and start a task                      |
| `close_task`     | Close a completed task                                  |
| `manage_deps`    | Add, remove, or list dependencies between tasks         |
| `blocked_tasks`  | Show tasks blocked by unresolved dependencies           |
| `project_stats`  | Project health snapshot: counts, ready work, lead time  |

**Discovery:**

| Tool           | Description                                 |
| -------------- | ------------------------------------------- |
| `list_agents`  | Show agents currently online                |
| `query_beads`  | Query Beads DB (messages, tasks, any type) with preset and raw label filters |

## Shortcuts

**Cursor** (via rules): `#help` `#cm` `#sm` `#ch` `#id` `#wi` `#ct` `#lt` `#st` `#rt` `#la` `#log` `#orchestrate`

**Claude Code** (via skills): `/am` `/cm` `/sm` `/ch` `/id` `/wi` `/ct` `/lt` `/st` `/rt` `/la` `/log` `/orchestrate`

## Orchestrate Workflow

`#orchestrate <feature>` (Cursor) or `/orchestrate` (CC) activates a structured development workflow pairing Cursor as **orchestrator** (brainstormer, designer, spec writer, plan reviewer) and Claude Code as **implementer** (spec verifier, plan writer, coder).

Built on the [superpowers](https://github.com/superpowers-ai/superpowers) process: Cursor uses `brainstorming` for design rigor, CC uses `writing-plans` and `subagent-driven-development` for implementation with TDD. Abandon at any step — no state to clean up.

See [docs/setup-guide.md](docs/setup-guide.md) for the full workflow description.

## Identity & Multi-Agent

Each agent gets a unique session ID on startup (e.g. `claude-code-a3f2`). The base ID (`claude-code`) is shared across all instances — messages to the base ID reach every instance. Use `set_identity` (`#id` / `/id`) to pick a memorable name like `cc-design`.

When multiple agent windows/terminals are open in the same project:

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

## Troubleshooting

Run `agent-messenger doctor` first — it checks everything automatically.

| Problem | Fix |
| ------- | --- |
| `agent-messenger` not recognized (Windows) | npm global bin isn't in PATH — see the [Windows note](#quick-start) above |
| MCP server disabled after PC sleep/wake | Toggle it off and back on in Cursor Settings > Tools & MCP ([known Cursor issue](https://forum.cursor.com/t/cursor-mcp-client-fails-to-reconnect-after-network-drop-or-sleep-wake-cycle/151578)) |
| "driver: bad connection" | Run `bd dolt start` — the Dolt server isn't running |
| MCP not appearing in Cursor | Restart Cursor; check `.cursor/mcp.json` exists with correct paths |

See [docs/setup-guide.md](docs/setup-guide.md) for the full troubleshooting table and usage guide.

## Contributing

See [docs/development.md](docs/development.md) for build-from-source instructions, manual configuration, and project structure. The project uses [Beads](https://github.com/steveyegge/beads) for issue tracking — run `bd ready` to find available work.

## License

MIT
