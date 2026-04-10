# Agent Messenger — Setup & Usage Guide

An MCP server that lets AI agents (Cursor, Claude Code) send messages to each other within a project, backed by [Beads](https://github.com/steveyegge/beads) for persistent storage.

## Automated Setup (Recommended)

```bash
npm install -g cursor-claude-messenger
cd your-project
agent-messenger init
```

Or from source:

```bash
git clone https://github.com/wolfego/agent-messenger.git
cd agent-messenger && npm install && npm run build
cd your-project
node /path/to/agent-messenger/dist/cli/index.js init
```

Use `--dry-run` to preview changes without writing anything.

This handles everything: Beads initialization, MCP config generation (with correct `--beads-dir` and `--env`), Cursor rules, and Claude Code skills. Then restart Cursor and you're done.

If something isn't working:

```bash
agent-messenger doctor
```

This checks prerequisites, configs, paths, and server connectivity — and tells you exactly what to fix.

## Prerequisites

| Dependency       | Version | Install                                                                                                  |
| ---------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| Node.js          | 20+     | [https://nodejs.org](https://nodejs.org)                                                                 |
| Beads (`bd` CLI) | 1.0.0+  | `npm install -g @beads/bd` or [manual install](https://github.com/steveyegge/beads/releases)            |
| Dolt             | 1.85.0+ | [https://docs.dolthub.com/introduction/installation](https://docs.dolthub.com/introduction/installation) |

> **Windows note:** The npm install for Beads may fail on Windows. Download `bd.exe` directly from [GitHub releases](https://github.com/steveyegge/beads/releases) and place it on your PATH (e.g., `C:\Users\<you>\.local\bin`).

## Manual Setup

If you prefer manual control or the installer doesn't fit your setup:

### 1. Install agent-messenger

```bash
npm install -g cursor-claude-messenger
```

Or clone and build from source:

```bash
git clone https://github.com/wolfego/agent-messenger.git
cd agent-messenger
npm install && npm run build
```

### 2. Initialize Beads in your project

```bash
cd your-project
bd init --server    # uses Dolt server mode (required on Windows)
```

Add `.beads/` to your project's `.gitignore`.

### 3. Register in Cursor

Create `.cursor/mcp.json` in your project. **Critical:** `--beads-dir` must point to the `.beads` directory, not the project root:

```json
{
  "mcpServers": {
    "agent-messenger": {
      "command": "node",
      "args": ["/path/to/agent-messenger/dist/index.js", "--agent-id", "cursor-opus", "--beads-dir", "/path/to/your-project/.beads", "--env", "cursor"],
      "transport": "stdio"
    }
  }
}
```

Restart Cursor to pick up the MCP server.

### 4. Register in Claude Code

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "agent-messenger": {
      "command": "node",
      "args": ["/path/to/agent-messenger/dist/index.js", "--agent-id", "claude-code", "--beads-dir", "/path/to/your-project/.beads"],
      "transport": "stdio"
    }
  }
}
```

When CC starts, it will prompt you to accept the new MCP server.

### 5. Install Cursor rule and CC skills

**Cursor:** Copy `.cursor/rules/agent-messenger.mdc` from this repo into your project's `.cursor/rules/`.

**Claude Code:** Copy the `.claude/skills/` folder from this repo into your project's `.claude/` directory.

### Shortcuts Reference

**Messaging:**

| Action         | Cursor | Claude Code |
| -------------- | ------ | ----------- |
| Help           | `#help`| `/am`       |
| Check messages | `#cm`  | `/cm`       |
| Send message   | `#sm`  | `/sm`       |
| Set channel    | `#ch`  | `/ch`       |
| Set identity   | `#id`  | `/id`       |
| Who am I       | `#wi`  | `/wi`       |

**Tasks:**

| Action         | Cursor | Claude Code |
| -------------- | ------ | ----------- |
| Create task    | `#ct`  | `/ct`       |
| List tasks     | `#lt`  | `/lt`       |
| Show task      | `#st`  | `/st`       |
| Ready tasks    | `#rt`  | `/rt`       |

**Discovery:**

| Action         | Cursor | Claude Code |
| -------------- | ------ | ----------- |
| List agents    | `#la`  | `/la`       |

**Workflow:**

| Action         | Cursor         | Claude Code    |
| -------------- | -------------- | -------------- |
| Orchestrate    | `#orchestrate` | `/orchestrate` |

## MCP Tools Reference

**Messaging:**

| Tool                 | Description                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `send_message`       | Send a message to another agent (`to`, `subject`, `body`, `action`, `context_files`, `priority`, `worktree`, `task_id`) |
| `check_inbox`        | Check for unread messages (optional: `include_read`)                                             |
| `reply`              | Reply to a message by ID (auto-threads via `replies_to`). Optional `task_id` to link to a task   |
| `get_thread`         | Get full conversation thread from any message ID in it                                           |
| `list_conversations` | List all conversations this agent is part of                                                     |
| `mark_read`          | Mark a message as read                                                                           |
| `whoami`             | Show agent identity (session ID, base ID, env) and current channel                               |
| `set_channel`        | Join a channel for multi-agent isolation                                                         |
| `set_identity`       | Rename this agent instance (e.g. `cc-web-ui`). Re-registers presence. Still receives messages to base ID |

**Tasks:**

| Tool             | Description                                                          |
| ---------------- | -------------------------------------------------------------------- |
| `create_task`    | Create a new task in Beads (title, description, priority, labels, deps, assignee) |
| `create_epic`    | Create an epic for phased planning (groups related tasks under a parent)           |
| `list_tasks`     | List tasks with filters (status, assignee, priority, ready-only)     |
| `show_task`      | Show detailed info about a task; includes linked messages if any     |
| `update_task`    | Update status, description, notes, labels, priority, or assignee. Smart-routes: `status=closed` triggers proper close with lifecycle event; `status=open` on a closed task triggers reopen |
| `claim_task`     | Atomically assign a task to yourself and set it to in_progress       |
| `close_task`     | Close a completed task, optionally showing newly unblocked tasks     |
| `manage_deps`    | Add, remove, or list dependencies between tasks. Supports 10 dependency types: blocks, tracks, related, parent-child, discovered-from, until, caused-by, validates, relates-to, supersedes |
| `blocked_tasks`  | Show tasks blocked by unresolved dependencies (graph-computed, not just status label). Optional `parent` filter to scope to an epic subtree |
| `project_stats`  | Project health snapshot: issue counts by state, ready work, average lead time, recent 24h activity |

**Discovery:**

| Tool           | Description                                                          |
| -------------- | -------------------------------------------------------------------- |
| `list_agents`  | Show agents currently online (based on presence records)             |

## Identity & Channels

### How identity works

Each MCP server instance has a **base ID** (configured via `--agent-id`, e.g. `cursor-opus`) and a **session ID** that's auto-generated on startup by appending an environment hint and a short random suffix (e.g. `claude-code-ext-a3`, `claude-code-term-b7`).

- **Base ID** — shared by all instances of the same agent type. Messages addressed to the base ID are received by every instance.
- **Session ID** — unique to each running instance. Includes the detected environment (`cursor`, `term`, `ext`) for readability.
- **Custom name** — use `set_identity` (or `#id` / `/id`) to pick a human-friendly name like `cc-web-ui` or `cc-auth-tests`.

Use `whoami` (`#wi` / `/wi`) to see your current identity at any time.

If you don't want auto-naming (e.g. for scripting), pass `--no-auto-id` and the agent will use the exact `--agent-id` with no suffix.

### Set identity early

**Run `/id` as early as practical in every new Claude Code session** — terminal or tab. Pick a short name that reflects what the session is working on:

```
[CC tab]      /id cc-web-ui
[CC terminal] /id cc-auth-tests
```

This makes `list_agents` (`#la` / `/la`) useful — instead of seeing `claude-code-ext-a3` and `claude-code-ext-b7`, you see `cc-web-ui` and `cc-auth-tests`. It also updates the agent's presence record so other agents can discover and address it by name.

The MCP server instructions already prompt CC agents to auto-name themselves on their first turn, but an explicit `/id` at session start is the most reliable approach.

### How routing works

Messages are routed using Beads labels:

- `to:claude-code` — addressed to the base ID; **all** `claude-code-*` instances receive it
- `to:cc-design` — addressed to a specific instance; only that agent receives it
- `from:cursor-opus-a3f2` — sent by a specific session
- `unread` — not yet read by the recipient

### One pair of agents (simple case)

If you only have one Cursor window and one CC terminal in a project, just use the defaults. Each gets a unique session ID automatically; you can address them by base ID and it works fine.

### Multiple agents in the same project

When multiple instances are running (e.g. two CC terminals), there are two strategies:

**Strategy 1: Identity naming** — give each instance a descriptive name:

```
[CC Terminal 1]  /id cc-design
[CC Terminal 2]  /id cc-auth
[Cursor]         Send message to cc-design: "review the design doc"
```

Each instance gets messages addressed to its name or its base ID.

**Strategy 2: Channels** — group agents into isolated conversations:

```
[Cursor]       #ch design-review
[CC Terminal]  set channel to design-review
```

Only agents on the same channel see each other's messages. You can also set a channel at startup:

```json
{
  "args": ["...dist/index.js", "--agent-id", "cursor-opus", "--channel", "design"]
}
```

Both strategies can be combined.

## Workflow Examples

### Basic: Send a message and get a reply

**In Cursor:** "Send a message to claude-code asking it to review docs/design.md"

Cursor calls `send_message(to: "claude-code", subject: "Review design doc", body: "...", action: "review", context_files: ["docs/design.md"])`.

**In CC terminal:** `/cm` (or "check your inbox using the check_inbox tool")

CC calls `check_inbox()`, sees the message, reads the file, and calls `reply(message_id: "...", body: "Here's my review...")`.

**In Cursor:** `#cm`

Cursor calls `check_inbox()`, reads the reply, and acts on it.

### Orchestrate Workflow

`#orchestrate <feature>` (Cursor) activates a structured development workflow where Cursor is the **orchestrator** and Claude Code is the **implementer**. Built on the [superpowers](https://github.com/superpowers-ai/superpowers) process for rigor. Optional — abandon at any step with no cleanup.

**Roles and superpowers skills used:**

| Phase | Cursor (orchestrator) | Claude Code (implementer) | Superpowers skills |
|---|---|---|---|
| Brainstorm | Explores approaches, presents trade-offs | Challenges assumptions, proposes alternatives | `brainstorming` (Cursor) |
| Spec | Writes spec doc, runs spec review loop | Verifies completeness, flags gaps | `brainstorming` doc step (Cursor) |
| Plan | Reviews the plan for TDD steps, ordering, coverage | Writes bite-sized implementation plan | `writing-plans` (CC) |
| Implementation | Monitors, unblocks, answers design questions | Implements with TDD, spec+quality review per task | `subagent-driven-development` or `executing-plans` (CC), `test-driven-development` |
| Finish | Reviews changes, verifies tests | Presents merge/PR/keep/discard options | `finishing-a-development-branch` (CC), `verification-before-completion` |

**Example flow:**

```
[Cursor] User: #orchestrate add WebSocket support
```

Cursor uses `superpowers:brainstorming` — explores context, asks clarifying questions one at a time, proposes 2-3 approaches, presents design. After user approves: "Shall I send to CC for challenge?"

```
[Cursor] User: y
```

Cursor sends with `action: challenge`. Prompts user to switch.

```
[CC] User: /cm
```

CC challenges the design, replies with counter-proposals. User switches back.

```
[Cursor] User: #cm
```

Cursor synthesizes both perspectives, writes spec to `docs/superpowers/specs/`, runs spec review loop. After user approves written spec: "Shall I send to CC for verification and plan writing?"

```
[Cursor] User: y
[CC] User: /cm
```

CC verifies the spec, then uses `superpowers:writing-plans` to create a bite-sized TDD plan at `docs/superpowers/plans/`. Cursor reviews the plan. On approval, CC implements using `superpowers:subagent-driven-development` (TDD, two-stage review per task), then finishes with `superpowers:finishing-a-development-branch`.

**At each step, the user's role is: approve/redirect, then switch contexts.** The agents propose the next action and use superpowers skills for rigor — the user doesn't need to remember the workflow or the process.

### Multi-Agent Parallel Implementation

For larger features, fan out tasks to multiple CC terminals:

```
[Cursor] User: #ch impl-auth
[CC Terminal 1] User: set channel to impl-auth
```

```
[Cursor] User: #ch impl-ws
[CC Terminal 2] User: set channel to impl-ws
```

Now Cursor can switch channels to communicate with different implementers.

## Task-Message Linking

Messages and tasks can be cross-referenced using the `task_id` parameter on `send_message` and `reply`. When provided:

- The message gets a `refs:<task_id>` label, making it discoverable from the task
- `show_task` includes a `linked_messages` array showing all messages referencing that task
- When replying with a `task_id`, a summary of the reply is auto-appended to the task's notes

This closes the gap between "agents talking about work" and "the work itself" — context flows in both directions.

## CLI Commands

### `agent-messenger log`

View message history from the terminal:

```bash
agent-messenger log                     # Last 20 messages, chronological
agent-messenger log -n 50               # Last 50 messages
agent-messenger log --agent claude-code # Filter by sender
agent-messenger log --channel design    # Filter by channel
agent-messenger log --thread <msg-id>   # Show a conversation thread
```

### `agent-messenger status`

See unread counts, recent messages, active agents, and channels at a glance:

```bash
agent-messenger status
```

## Dolt Server Management

Beads uses Dolt as its database in server mode. The Dolt server must be running for messaging to work.

```bash
bd dolt start       # Start the Dolt server
bd dolt stop        # Stop it
bd doctor           # Health check
```

If you see "driver: bad connection" errors, the Dolt server likely isn't running. Start it with `bd dolt start`.

## Troubleshooting

Run `agent-messenger doctor` first — it checks everything automatically.

| Problem                           | Fix                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `agent-messenger` not recognized (Windows) | npm global bin isn't in PATH. Run `npm prefix -g` to find it, then add it: `[Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";$(npm prefix -g)", "User")` and restart your terminal |
| `bd` not found                    | Install Beads and ensure `bd` is on your PATH                                  |
| "driver: bad connection"          | Run `bd dolt start` — the Dolt server isn't running                            |
| "embedded Dolt requires CGO"      | Use `bd init --server` instead of `bd init` (required on Windows)              |
| MCP not appearing in Cursor       | Restart Cursor; check `.cursor/mcp.json` exists with correct paths             |
| Messages not routing              | Check agent IDs match (`whoami`); run `agent-messenger doctor` to verify paths |
| Inbox shows other pair's messages | Use `set_channel` to isolate conversations                                     |
| `--beads-dir` errors              | Must point to `.beads/` directory, not the project root                        |

