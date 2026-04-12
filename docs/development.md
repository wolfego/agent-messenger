# Development Guide

For contributors and advanced users who need manual control over configuration.

## Build from Source

```bash
git clone https://github.com/wolfego/agent-messenger.git
cd agent-messenger
npm install
npm run build
npm test
```

Use the local build in a project:

```bash
cd your-project
node /path/to/agent-messenger/dist/cli/index.js init
```

## Manual MCP Configuration

If you need to configure MCP servers without `agent-messenger init`:

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "agent-messenger": {
      "command": "node",
      "args": [
        "/path/to/agent-messenger/dist/index.js",
        "--agent-id", "cursor-opus",
        "--beads-dir", "/path/to/your-project/.beads",
        "--env", "cursor"
      ],
      "transport": "stdio"
    }
  }
}
```

### Claude Code (`.mcp.json`)

```json
{
  "mcpServers": {
    "agent-messenger": {
      "command": "node",
      "args": [
        "/path/to/agent-messenger/dist/index.js",
        "--agent-id", "claude-code",
        "--beads-dir", "/path/to/your-project/.beads"
      ],
      "transport": "stdio"
    }
  }
}
```

**Critical:** `--beads-dir` must point to the `.beads` directory, not the project root.

The `--env` flag tells the server which environment it's running in (`cursor` or omitted for CC). This affects session ID generation (e.g. `cursor-opus-a3f2` vs `claude-code-ext-b7`).

## Message Routing Internals

Messages route via Beads labels on chore records:

| Label              | Purpose                                            |
| ------------------ | -------------------------------------------------- |
| `to:<agent-id>`    | Addressed to a specific agent or base ID           |
| `from:<agent-id>`  | Sent by this agent                                 |
| `unread`           | Not yet fetched by the recipient                   |
| `channel:<name>`   | Scoped to a channel                                |
| `refs:<task-id>`   | Cross-references a Beads task                      |
| `kind:presence`    | Marks a record as a presence heartbeat (not a msg) |
| `agent:<agent-id>` | Tags presence records with the agent's identity    |

Routing logic: `check_inbox` queries for open chore records with `to:<my-id>` or `to:<my-base-id>` and the `unread` label. Channel filtering adds `channel:<name>` to the query.

## Presence System

Each MCP server instance registers a presence record on startup (a Beads chore with `kind:presence` and `agent:<id>` labels). A heartbeat updates the record every 2 minutes. Records older than 5 minutes are considered stale.

- `registerPresence` — creates or refreshes a presence record, starts the heartbeat timer
- `deregisterPresence` — clears the heartbeat and closes the record (called on process exit)
- `cleanStalePresence` — closes all stale presence records on startup
- `listAgents` — returns only non-stale presence records

When an agent changes identity via `set_identity`, the old presence record is closed and a new one is created.

## MCP Tool Parameters

Full parameter details for each tool:

### Messaging

**`send_message`** — `to` (string), `subject` (string), `body` (string), `action?` (string: review, brainstorm, implement, reply, challenge, verify-spec), `context_files?` (string[]), `priority?` (string), `worktree?` (string), `task_id?` (string)

**`check_inbox`** — `include_read?` (boolean)

**`reply`** — `message_id` (string), `body` (string), `action?` (string), `context_files?` (string[]), `task_id?` (string)

**`get_thread`** — `message_id` (string)

**`list_conversations`** — no params

**`mark_read`** — `message_id` (string)

**`set_channel`** — `channel` (string, empty to clear)

**`set_identity`** — `name` (string)

**`whoami`** — no params

### Tasks

**`create_task`** — `title` (string), `description?` (string), `priority?` (P0-P4), `type?` (task/bug/feature/epic/chore), `labels?` (string[]), `parent?` (string), `assignee?` (string)

**`create_epic`** — `title` (string), `description?` (string), `priority?` (P0-P4)

**`list_tasks`** — `status?` (open/closed/all), `assignee?` (string), `priority?` (string), `label?` (string), `ready_only?` (boolean)

**`show_task`** — `task_id` (string)

**`update_task`** — `task_id` (string), `status?` (string), `description?` (string), `notes?` (string), `labels?` (string[]), `priority?` (string), `assignee?` (string)

**`claim_task`** — `task_id` (string)

**`close_task`** — `task_id` (string)

**`manage_deps`** — `action` (add/remove/list), `source?` (string), `target?` (string), `dep_type?` (string: blocks, tracks, related, parent, child, discovered-from, until, caused-by, validates, supersedes)

**`blocked_tasks`** — `parent?` (string)

**`project_stats`** — no params

### Discovery

**`list_agents`** — no params

**`query_beads`** — `type` (string: message/task/bug/feature/epic/chore), `from?` (string), `to?` (string), `channel?` (string), `labels?` (string[]), `status?` (open/closed/all), `limit?` (number), `sort?` (created/updated/priority), `reverse?` (boolean)

### Workflows

**`scaffold_workflow`** — `name` (string: "orchestrate" | "debug"), `path?` (string override for doc location)

**`workflow_checkpoint`** — `workflow` (string), `feature` (string), `phase` (string), `status` ("started" | "completed")

**`workflow_status`** — `workflow?` (string), `feature?` (string)

## Dolt Server Management

Beads uses Dolt in server mode. The Dolt server must be running for messaging to work.

```bash
bd dolt start       # Start the Dolt server
bd dolt stop        # Stop it
bd doctor           # Health check (Beads-level)
```

## Issue Tracking

This project uses [Beads](https://github.com/steveyegge/beads) for issue tracking:

```bash
bd ready             # Find available work
bd show <id>         # View issue details
bd update <id> --claim  # Claim work
bd close <id>        # Complete work
bd dolt push         # Push Beads data to remote
```

## Project Structure

```
src/
  index.ts           # MCP server entry point
  config.ts          # CLI arg parsing, agent ID generation
  beads.ts           # Low-level bd CLI interactions (messages, tasks, presence)
  tasks.ts           # Task management logic
  tools/             # One file per MCP tool handler
  cli/
    index.ts         # CLI entry point (init, doctor, status, log)
    init.ts          # Project setup and upgrade logic
    doctor.ts        # Diagnostic checks
    postinstall.ts   # Windows PATH check after npm install
docs/
  setup-guide.md     # User-facing usage guide
  development.md     # This file
  plans/             # Design docs and roadmap
```
