# Agent Messenger — Setup & Usage Guide

An MCP server that lets AI agents (Cursor, Claude Code) send messages to each other within a project, backed by [Beads](https://github.com/gastownhall/beads) for persistent storage.

## Automated Setup (Recommended)

```bash
npm install -g agent-messenger
cd your-project
agent-messenger init
```

This handles everything: Beads initialization, MCP config generation (with correct `--beads-dir`), Cursor rules, and Claude Code skills. Then restart Cursor and you're done.

If something isn't working:

```bash
agent-messenger doctor
```

This checks prerequisites, configs, paths, and server connectivity — and tells you exactly what to fix.

## Prerequisites

| Dependency       | Version | Install                                                                                                  |
| ---------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| Node.js          | 18+     | [https://nodejs.org](https://nodejs.org)                                                                 |
| Beads (`bd` CLI) | 1.0.0+  | `npm install -g @beads/bd` or [manual install](https://github.com/gastownhall/beads/releases)            |
| Dolt             | 1.85.0+ | [https://docs.dolthub.com/introduction/installation](https://docs.dolthub.com/introduction/installation) |

> **Windows note:** The npm install for Beads may fail on Windows. Download `bd.exe` directly from [GitHub releases](https://github.com/gastownhall/beads/releases) and place it on your PATH (e.g., `C:\Users\<you>\.local\bin`).

## Manual Setup

If you prefer manual control or the installer doesn't fit your setup:

### 1. Install agent-messenger

```bash
npm install -g agent-messenger
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
      "args": ["/path/to/agent-messenger/dist/index.js", "--agent-id", "cursor-opus", "--beads-dir", "/path/to/your-project/.beads"],
      "transport": "stdio"
    }
  }
}
```

> **Fallback:** Cursor may not read project-level MCP configs if `.cursor/` is gitignored. Also add the entry to `~/.cursor/mcp.json` (user-level).

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

| Action         | Cursor | Claude Code |
| -------------- | ------ | ----------- |
| Check messages | `#cm`  | `/cm`       |
| Send message   | `#sm`  | `/sm`       |
| Set channel    | `#ch`  | `/ch`       |
| Who am I       | `#wi`  | `/wi`       |

## MCP Tools Reference

| Tool                 | Description                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `send_message`       | Send a message to another agent (`to`, `subject`, `body`, `action`, `context_files`, `priority`) |
| `check_inbox`        | Check for unread messages (optional: `include_read`)                                             |
| `reply`              | Reply to a message by ID (auto-threads via `replies_to`)                                         |
| `get_thread`         | Get full conversation thread from any message ID in it                                           |
| `list_conversations` | List all conversations this agent is part of                                                     |
| `mark_read`          | Mark a message as read                                                                           |
| `whoami`             | Show agent identity and current channel                                                          |
| `set_channel`        | Join a channel for multi-agent isolation                                                         |

## Identity & Channels

### How routing works

Each MCP server instance runs with an `--agent-id` (e.g., `cursor-opus`, `claude-code`). Messages are routed using labels:

- `to:claude-code` — addressed to the agent with ID `claude-code`
- `from:cursor-opus` — sent by the agent with ID `cursor-opus`
- `unread` — not yet read by the recipient

### One pair of agents (simple case)

If you only have one Cursor window and one CC terminal in a project, the default IDs (`cursor-opus` and `claude-code`) are sufficient. No channels needed.

### Multiple agent pairs in the same project

If you have multiple Cursor windows or CC terminals open in the same project, use **channels** to prevent cross-talk:

1. Tell Cursor window A: `#ch design-review`
2. Tell CC terminal A: set channel to `design-review`
3. Now only these two see each other's messages

Other agent windows without a channel (or on a different channel) won't see those messages.

You can also set a channel at startup via `--channel`:

```json
{
  "args": ["...dist/index.js", "--agent-id", "cursor-opus", "--channel", "design"]
}
```

## Workflow Examples

### Basic: Send a message and get a reply

**In Cursor:** "Send a message to claude-code asking it to review docs/design.md"

Cursor calls `send_message(to: "claude-code", subject: "Review design doc", body: "...", action: "review", context_files: ["docs/design.md"])`.

**In CC terminal:** `/cm` (or "check your inbox using the check_inbox tool")

CC calls `check_inbox()`, sees the message, reads the file, and calls `reply(message_id: "...", body: "Here's my review...")`.

**In Cursor:** `#cm`

Cursor calls `check_inbox()`, reads the reply, and acts on it.

### Superpowers Development Workflow

A full feature development cycle using agent-messenger to coordinate between agents. The human drives each step with a short command, and the agents communicate directly instead of requiring copy-paste.

#### Phase 1: Brainstorm

```
[Cursor] User: "Brainstorm approaches for adding WebSocket support to our API.
               Send your brainstorm to cc for challenge and counter-proposals."
```

Cursor brainstorms, then calls `send_message(to: "claude-code", ...)`.

```
[CC] User: /cm
```

CC reads the brainstorm, challenges assumptions, adds alternatives, and calls `reply(...)`.

```
[Cursor] User: #cm — then "synthesize both perspectives into a design"
```

#### Phase 2: Design & Spec

```
[Cursor] User: "Write the design doc at docs/websocket-design.md, then send it
               to cc for architecture review"
```

```
[CC] User: /cm
```

CC reviews the design for edge cases, security concerns, and scalability. Replies with findings.

```
[Cursor] User: #cm — then "address the feedback and write the spec"
```

#### Phase 3: Plan Review

```
[Cursor] User: "Write the implementation plan at docs/plans/websocket.md,
               then send to cc for review"
```

```
[CC] User: /cm
```

CC reviews the plan for task ordering, missing dependencies, and estimates. Replies.

#### Phase 4: Implementation

```
[Cursor] User: #cm — then "incorporate feedback and begin implementing step 1"
```

#### Phase 5: Code Review

```
[Cursor] User: "send the diff of this branch to cc for code review"
```

```
[CC] User: /cm
```

CC reviews the code, replies with findings. Cursor addresses them.

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
| `bd` not found                    | Install Beads and ensure `bd` is on your PATH                                  |
| "driver: bad connection"          | Run `bd dolt start` — the Dolt server isn't running                            |
| "embedded Dolt requires CGO"      | Use `bd init --server` instead of `bd init` (required on Windows)              |
| MCP not appearing in Cursor       | Restart Cursor; also add entry to `~/.cursor/mcp.json` as fallback             |
| Messages not routing              | Check agent IDs match (`whoami`); run `agent-messenger doctor` to verify paths |
| Inbox shows other pair's messages | Use `set_channel` to isolate conversations                                     |
| `--beads-dir` errors              | Must point to `.beads/` directory, not the project root                        |

