# agent-messenger

[![CI](https://github.com/wolfego/agent-messenger/actions/workflows/ci.yml/badge.svg)](https://github.com/wolfego/agent-messenger/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

MCP server that unifies agent-to-agent messaging and task management for AI coding agents — Cursor, Claude Code, Codex, Windsurf, Aider, and any MCP-capable tool. Agents send messages, reply in threads, create and track tasks, manage dependencies, and follow structured workflows. Messages use a fast local file store (`.am/`); tasks and project tracking are backed by [Beads](https://github.com/steveyegge/beads) for persistent, version-controlled storage.

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

The `init` command handles message store setup (`.am/`), Beads initialization, MCP config generation, Cursor rules, and Claude Code skills. If something doesn't work, run:

```bash
agent-messenger doctor
```

## How It Works

All agents connect to the same MCP server with different identities. The server auto-detects the agent environment (Cursor, Codex, Windsurf, etc.) or accepts any string via `--env`. Messages are stored in a fast local file store (`.am/`) with metadata/body separation for instant reads. Tasks and project tracking use Beads (Dolt) for version-controlled persistence. Threading, channels, and routing work the same across both stores.

```
┌──────────────┐         ┌─────────────────────┐         ┌──────────────┐
│    Cursor     │◄─stdio─►│  agent-messenger MCP │◄─stdio─►│  Claude Code  │
│  one shared   │         │                     │         │  cc-design    │
│  connection   │         │  send_message       │         └──────────────┘
│ #cm #sm #id   │         │  check_inbox        │
└──────────────┘         │  reply / get_thread  │         ┌──────────────┐
                          │  set_channel / ...   │◄─stdio─►│  Codex / etc  │
                          │                     │         │  codex-impl   │
                          │  ┌───────────────┐  │         └──────────────┘
                          │  │  .am/ messages │  │
                          │  │  .beads/ tasks │  │              ...
                          │  └───────────────┘  │
                          └─────────────────────┘
```

## Shortcuts (25 tools)

| Command            | Cursor           | CC               | What it does                                     |
| ------------------ | ---------------- | ---------------- | ------------------------------------------------ |
| Check inbox        | `#cm`            | `/cm`            | Read and act on unread messages                  |
| Send message       | `#sm`            | `/sm`            | Send a message to another agent                  |
| Set channel        | `#ch`            | `/ch`            | Isolate conversations for multi-agent setups     |
| Set identity       | `#id`            | `/id`            | Rename this agent (e.g. `cc-design`)             |
| Who am I           | `#wi`            | `/wi`            | Show identity, base ID, and channel              |
| Create task        | `#ct`            | `/ct`            | Create a task in Beads                           |
| List tasks         | `#lt`            | `/lt`            | Filter by status, priority, or ready-only        |
| Show task          | `#st`            | `/st`            | Task details and linked messages                 |
| Ready tasks        | `#rt`            | `/rt`            | Unblocked tasks ready to work on                 |
| List agents        | `#la`            | `/la`            | Who is currently online                          |
| Browse history     | `#log`           | `/log`           | Message history, filter by sender                |
| Orchestrate        | `#orchestrate`   | `/orchestrate`   | Start orchestrator/implementer workflow           |
| Debug              | `#debug`         | `/debug`         | Start systematic two-agent debug workflow         |
| Workflow status    | `#ws`            | `/ws`            | Current phase for active workflows                |
| Help               | `#help`          | `/am`            | Show available commands                          |

Agents also use tools automatically on your behalf (threading, replying, managing dependencies, etc.). See [docs/development.md](docs/development.md) for the full 25-tool API reference.

## Workflows

agent-messenger includes two structured workflows that pair Cursor (orchestrator) with Claude Code (implementer). Each workflow is defined by a **living document** in your project that evolves through use.

**Orchestrate** (`#orchestrate <feature>`) — structured feature development: brainstorm, spec, plan, implement, verify. Built on [superpowers](https://github.com/superpowers-ai/superpowers).

**Debug** (`#debug <description>`) — systematic two-agent debugging: triage, hypothesize, investigate, diagnose, fix, verify. Includes a Diagnostic Resources section for project-specific tools.

Workflow docs are created automatically on first use at `docs/guidance/workflows/`. Phase transitions are tracked in Beads via `workflow_checkpoint`. Abandon at any step — no state to clean up.

See [docs/setup-guide.md](docs/setup-guide.md) for the full workflow descriptions.

## Task Management

Agents can create, track, and coordinate work — not just talk about it. Tasks are stored in Beads (a Dolt database), so they persist across sessions, agent restarts, and conversations.

**Lifecycle:** Create a task (`#ct`) → claim it (`claim_task`) → work → close it (`close_task`). Tasks have status, priority, labels, assignee, and notes.

**Epics:** Group related tasks under an epic for phased planning. Agents can create epics and nest tasks beneath them.

**Dependencies:** Tasks can block, track, or relate to each other. The dependency graph powers `#rt` (ready tasks) — showing only tasks whose blockers are resolved, so agents always know what to work on next.

**Task-message linking:** Pass `task_id` when sending or replying to link conversations to work items. `show_task` then surfaces all related messages. Context flows both directions — the discussion and the work stay connected.

**Project stats:** `project_stats` gives a health snapshot: open/closed counts, ready work, lead time, and recent activity.

Messages live in the fast local file store (`.am/`) for low-latency conversations. Tasks are the persistent, version-controlled record in Beads of what needs to happen, what's in progress, and what's done.

## Identity & Multi-Agent

**Cursor** shares a single MCP connection across all agent tabs (Opus, Codex, etc.) in a workspace. All Cursor agents appear as one identity — when another agent messages "cursor", every Cursor agent receives it.

**Claude Code** gets a separate MCP connection per instance (whether in a terminal or a tab), so each has its own identity (e.g. `claude-code-a3f2`, `claude-code-b1c9`). Cursor can address them individually.

**Other agents** (Codex, Windsurf, Aider) are auto-detected via environment variables when possible. Any MCP-capable tool can connect by passing `--env <name>` — the server accepts any string for forward compatibility.

Use `set_identity` to pick memorable names — `#id cursor-lead` in Cursor, `/id cc-design` and `/id cc-impl` in each CC instance. Use channels (`#ch` / `/ch`) to isolate conversations when multiple agents are active.

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
| `--cursor-id <id>` | `cursor`       | Cursor agent ID                   |
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
