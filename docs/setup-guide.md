# Agent Messenger — Usage Guide

MCP server that lets AI coding agents (Cursor, Claude Code, Codex, Windsurf, Aider, and any MCP-capable tool) message each other within a project.

## Install

**Prerequisites:** [Node.js 20+](https://nodejs.org), [Beads (`bd` CLI)](https://github.com/steveyegge/beads/releases) v1.0.0+, [Dolt](https://docs.dolthub.com/introduction/installation) v1.85.0+

```bash
npm install -g cursor-claude-messenger
cd your-project
agent-messenger init
```

Restart Cursor. Done.

> **Windows:** If `agent-messenger` isn't recognized after install, the npm global bin directory likely isn't in your PATH. Run `npm prefix -g` to find it, then add it permanently:
> ```powershell
> [Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";$(npm prefix -g)", "User")
> ```
> Restart your terminal after.

### Upgrading

```bash
npm install -g cursor-claude-messenger@latest
cd your-project
agent-messenger init
```

**Restart Cursor after upgrading** (Ctrl+Shift+P → "Developer: Reload Window"). The npm update replaces the MCP server files on disk — Cursor needs to restart the server process to pick up the new version.

Your Beads data (messages, tasks, history) is never affected by upgrades. If your Cursor rules or Claude Code skills have changed, `init` updates them and saves the old versions as `.bak` files.

### Init options

| Flag               | Default        | Description                                |
| ------------------ | -------------- | ------------------------------------------ |
| `--cursor-id <id>` | `cursor`       | Cursor agent ID                            |
| `--cc-id <id>`     | `claude-code`  | Claude Code agent ID                       |
| `--dry-run`        |                | Preview changes without writing   |
| `--skip-beads`     |                | Skip Beads/Dolt setup             |

### Diagnostics

```bash
agent-messenger doctor   # checks prerequisites, configs, paths, connectivity
agent-messenger status   # unread counts, active agents, channels
```

## Shortcuts

Both agents have shortcut commands — `#` prefix in Cursor, `/` prefix in Claude Code.

| Action           | Cursor         | Claude Code    | What it does                                        |
| ---------------- | -------------- | -------------- | --------------------------------------------------- |
| Help             | `#help`        | `/am`          | Show available commands                             |
| Check messages   | `#cm`          | `/cm`          | Read inbox, act on unread messages                  |
| Send message     | `#sm`          | `/sm`          | Compose and send to another agent                   |
| Set channel      | `#ch`          | `/ch`          | Join a channel for conversation isolation            |
| Set identity     | `#id`          | `/id`          | Rename yourself (e.g. `cc-design`)                  |
| Who am I         | `#wi`          | `/wi`          | Show your identity, base ID, and channel            |
| Create task      | `#ct`          | `/ct`          | Create a new task in Beads                          |
| List tasks       | `#lt`          | `/lt`          | Show open tasks sorted by priority                  |
| Show task        | `#st`          | `/st`          | Show full details for a task                        |
| Ready tasks      | `#rt`          | `/rt`          | Show tasks with no blockers                         |
| List agents      | `#la`          | `/la`          | See who is currently online                         |
| Message history  | `#log`         | `/log`         | Browse recent messages, optionally filter by sender |
| Orchestrate      | `#orchestrate` | `/orchestrate` | Start the structured orchestrator/implementer flow  |
| Debug            | `#debug`       | `/debug`       | Start the systematic two-agent debug workflow       |
| Workflow status  | `#ws`          | `/ws`          | Show current phase for active workflows             |

## Identity

Each agent gets a unique session ID on startup (e.g. `claude-code-ext-a3f2`). The **base ID** (`claude-code`) is shared across all instances of the same type — messages to the base ID reach every instance.

The server auto-detects the agent environment (Cursor, Codex, Windsurf) via environment variables, or you can pass any string with `--env <name>` for forward compatibility.

Use `#id` / `/id` to pick a memorable name:

```
[Cursor]       #id cursor-design
[CC terminal]  /id cc-auth
[Codex]        set_identity codex-api
```

This makes `#la` / `/la` more useful — you see `cc-auth` instead of `claude-code-ext-b7`. Set identity early in each session.

## Channels

When you have multiple agent windows/terminals open, use channels to isolate conversations:

```
[Cursor]       #ch design-review
[CC terminal]  /ch design-review
```

Only agents on the same channel see each other's messages. Clear the channel (empty name) to return to the global inbox.

Identity naming and channels can be combined.

## Workflow: Basic Messaging

1. **Cursor:** "Send a message to claude-code asking it to review the auth module"
   - Cursor calls `send_message` with subject, body, action, and context files.
2. **CC terminal:** `/cm`
   - CC reads the message, reviews the files, replies in the same thread.
3. **Cursor:** `#cm`
   - Cursor reads the reply and acts on it.

## Workflows

agent-messenger includes two structured workflows. Each is defined by a **living document** in your project — created automatically on first use, then refined after each session.

### Orchestrate

`#orchestrate <feature>` pairs Cursor as **orchestrator** and Claude Code as **implementer** for structured feature development. Built on [superpowers](https://github.com/superpowers-ai/superpowers).

| Phase      | Cursor (orchestrator)                    | Claude Code (implementer)                    |
| ---------- | ---------------------------------------- | -------------------------------------------- |
| Brainstorm | Explores approaches, presents trade-offs | Challenges assumptions, proposes alternatives |
| Spec       | Writes spec doc, runs 3-pass review      | Verifies completeness, flags gaps             |
| Plan       | Reviews plan for TDD, ordering, coverage | Writes bite-sized implementation plan         |
| Implement  | Monitors, unblocks, answers questions    | Implements with TDD, reviews per task         |
| Verify     | Reviews changes, verifies tests          | Runs quality gates, presents options          |
| Closeout   | Updates docs, creates PR                 | Updates workflow doc with lessons learned      |

On first use, `scaffold_workflow` creates `docs/guidance/workflows/orchestrate.md` — the full process definition including roles, review philosophy, and communication patterns. This document evolves with your project.

### Debug

`#debug <description>` pairs Cursor as **triager/diagnostician** and Claude Code as **investigator/fixer** for systematic bug investigation.

| Phase       | Cursor                            | Claude Code                              |
| ----------- | --------------------------------- | ---------------------------------------- |
| Triage      | Gathers symptoms, reads diag docs | —                                        |
| Hypothesize | Ranks hypotheses by likelihood    | —                                        |
| Investigate | Directs investigation             | Runs diagnostics, reports raw findings   |
| Diagnose    | Narrows to root cause             | —                                        |
| Fix         | Reviews fix approach              | TDD: failing test, fix, verify           |
| Verify      | Confirms no regressions           | Runs full quality gates                  |

On first use, `scaffold_workflow` creates `docs/guidance/workflows/debug.md` — includes a **Diagnostic Resources** section where you list your project's diagnostic tools, scripts, known failure patterns, and monitoring URLs. Agents entering a debug session read this first.

### Workflow tracking

Phase transitions are recorded in Beads via `workflow_checkpoint`. Use `#ws` / `/ws` to see where active workflows stand. Abandon at any step — no state to clean up.

### Example

```
[Cursor] #orchestrate add WebSocket support
```

Cursor brainstorms the design, asks clarifying questions, proposes approaches. After approval, sends to CC for challenge:

```
[CC] /cm       → reads design, pushes back on trade-offs, replies
[Cursor] #cm   → synthesizes, writes spec, sends to CC for plan writing
[CC] /cm       → verifies spec, writes implementation plan
[Cursor] #cm   → reviews plan, approves
[CC] /cm       → implements with TDD, finishes branch
```

At each step, your role is: approve or redirect, then switch contexts. The agents handle the process.

## Workflow: Multi-Agent Parallel

For larger features, fan tasks out to multiple CC terminals with channels:

```
[Cursor]         #ch impl-auth
[CC Terminal 1]  /ch impl-auth

[Cursor]         #ch impl-ws
[CC Terminal 2]  /ch impl-ws
```

Switch channels in Cursor to communicate with different implementers.

## Task-Message Linking

Messages and tasks can be cross-referenced using the `task_id` parameter on `send_message` and `reply`:

- The message gets linked to the task, making it discoverable via `show_task`
- Replies with a `task_id` auto-append a summary to the task's notes
- Context flows both directions — "agents talking about work" and "the work itself" stay connected

## CLI Commands

| Command                  | Description                                  |
| ------------------------ | -------------------------------------------- |
| `agent-messenger init`   | Set up agent-messenger in current project    |
| `agent-messenger doctor` | Diagnose common setup issues                 |
| `agent-messenger status` | Show unread counts, agents, and channels     |
| `agent-messenger log`    | View message history (filters, thread view)  |
| `agent-messenger help`   | Show help                                    |

### Message log options

| Flag                   | Description                           |
| ---------------------- | ------------------------------------- |
| `-n, --limit <num>`   | Number of messages (default: 20)      |
| `-a, --agent <id>`    | Filter by sender                      |
| `-c, --channel <ch>`  | Filter by channel                     |
| `-t, --thread <id>`   | Show a specific conversation thread   |

## Troubleshooting

Run `agent-messenger doctor` first — it checks everything automatically.

| Problem                                    | Fix                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `agent-messenger` not recognized (Windows) | npm global bin isn't in PATH — see the [Windows note](#install) above                |
| MCP server disabled after PC sleep/wake    | Toggle it off and back on in Cursor Settings > Tools & MCP ([known Cursor issue][1]) |
| "driver: bad connection"                   | Run `bd dolt start` — the Dolt server isn't running                                  |
| "embedded Dolt requires CGO"               | Use `bd init --server` instead of `bd init` (required on Windows)                    |
| MCP not appearing in Cursor                | Restart Cursor; check `.cursor/mcp.json` exists with correct paths                   |
| Messages not routing                       | Check agent IDs (`#wi` / `/wi`); run `agent-messenger doctor`                        |
| Inbox shows other pair's messages          | Use channels (`#ch` / `/ch`) to isolate conversations                                |

[1]: https://forum.cursor.com/t/cursor-mcp-client-fails-to-reconnect-after-network-drop-or-sleep-wake-cycle/151578

For development setup and contributing, see [development.md](development.md).
