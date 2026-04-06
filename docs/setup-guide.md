# Agent Messenger — Setup & Usage Guide

An MCP server that lets AI agents (Cursor, Claude Code) send messages to each other within a project, backed by [Beads](https://github.com/gastownhall/beads) for persistent storage.

## Prerequisites


| Dependency       | Version | Install                                                                                                  |
| ---------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| Node.js          | 18+     | [https://nodejs.org](https://nodejs.org)                                                                 |
| Beads (`bd` CLI) | 1.0.0+  | `npm install -g @beads/bd` or [manual install](https://github.com/gastownhall/beads/releases)            |
| Dolt             | 1.85.0+ | [https://docs.dolthub.com/introduction/installation](https://docs.dolthub.com/introduction/installation) |


> **Windows note:** The npm install for Beads may fail on Windows. Download `bd.exe` directly from [GitHub releases](https://github.com/gastownhall/beads/releases) and place it on your PATH.

## Installation

### 1. Clone and build

```bash
git clone https://github.com/wolfego/agent-messenger.git
cd agent-messenger
npm install
npm run build
```

### 2. Initialize Beads in your project

In the project where you want agents to communicate (not in agent-messenger itself):

```bash
cd your-project
bd init --server    # uses Dolt server mode (required on Windows)
```

Add `.beads/` to your project's `.gitignore`.

### 3. Register in Cursor

Create `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "agent-messenger": {
      "command": "node",
      "args": ["C:\\path\\to\\agent-messenger\\dist\\index.js", "--agent-id", "cursor"],
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
      "args": ["C:\\path\\to\\agent-messenger\\dist\\index.js", "--agent-id", "cc"],
      "transport": "stdio"
    }
  }
}
```

When CC starts, it will prompt you to accept the new MCP server.

### 5. (Optional) Auto-polling and shortcuts

**Cursor:** Copy `.cursor/rules/agent-messenger.mdc` from this repo into your project's `.cursor/rules/`. This makes Cursor auto-check its inbox at the start of each conversation and enables `#cm` / `#sm` / `#ch` / `#wi` shortcuts.

**Claude Code:** Copy the `.claude/commands/` folder from this repo into your project's `.claude/` directory. This enables `/cm` `/sm` `/ch` `/wi` slash commands. Beads also installs a `SessionStart` hook that runs `bd prime` for context at session start.

### Shortcuts Reference

| Action | Cursor | Claude Code |
|---|---|---|
| Check messages | `#cm` | `/cm` |
| Send message | `#sm` | `/sm` |
| Set channel | `#ch` | `/ch` |
| Who am I | `#wi` | `/wi` |

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

Each MCP server instance runs with an `--agent-id` (e.g., `cursor`, `cc`). Messages are routed using labels:

- `to:cc` — addressed to the agent with ID `cc`
- `from:cursor` — sent by the agent with ID `cursor`
- `unread` — not yet read by the recipient

### One pair of agents (simple case)

If you only have one Cursor window and one CC terminal in a project, the default IDs (`cursor` and `cc`) are sufficient. No channels needed.

### Multiple agent pairs in the same project

If you have multiple Cursor windows or CC terminals open in the same project, use **channels** to prevent cross-talk:

1. Tell Cursor window A: "set channel to design-review"
2. Tell CC terminal A: "set channel to design-review"
3. Now only these two see each other's messages

Other agent windows without a channel (or on a different channel) won't see those messages.

You can also set a channel at startup via `--channel`:

```json
{
  "args": ["...dist/index.js", "--agent-id", "cursor", "--channel", "design"]
}
```

Or via environment variable (useful for CC terminals):

```bash
set AGENT_MESSENGER_ID=cc-design   # Windows
export AGENT_MESSENGER_ID=cc-design # macOS/Linux
```

## Workflow Examples

### Basic: Send a message and get a reply

**In Cursor:** "Send a message to cc asking it to review docs/design.md"

Cursor calls `send_message(to: "cc", subject: "Review design doc", body: "...", action: "review", context_files: ["docs/design.md"])`.

**In CC terminal:** `/cm`

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

Cursor brainstorms, then calls `send_message(to: "cc", subject: "WebSocket brainstorm", body: "<brainstorm>", action: "brainstorm")`.

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

Cursor writes the doc, then calls `send_message(to: "cc", ..., action: "review", context_files: ["docs/websocket-design.md"])`.

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

During implementation, if Cursor hits a blocker:

```
[Cursor] User: "send a message to cc describing this connection pooling issue
               and ask for help"
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
[Cursor] User: "set channel to impl-auth"
[CC Terminal 1] User: "set channel to impl-auth"
```

```
[Cursor] User: "set channel to impl-ws"
[CC Terminal 2] User: "set channel to impl-ws"
```

Now Cursor can switch channels to communicate with different implementers:

```
[Cursor] User: "set channel to impl-auth, send the auth middleware tasks"
[Cursor] User: "set channel to impl-ws, send the WebSocket handler tasks"
```

Each CC terminal only sees messages on its channel.

## Dolt Server Management

Beads uses Dolt as its database in server mode. The Dolt server must be running for messaging to work.

```bash
bd dolt start       # Start the Dolt server
bd dolt stop        # Stop it
bd doctor           # Health check
```

If you see "driver: bad connection" errors, the Dolt server likely isn't running. Start it with `bd dolt start`.

## Troubleshooting


| Problem                           | Fix                                                                      |
| --------------------------------- | ------------------------------------------------------------------------ |
| `bd` not found                    | Install Beads and ensure `bd` is on your PATH                            |
| "driver: bad connection"          | Run `bd dolt start` — the Dolt server isn't running                      |
| "embedded Dolt requires CGO"      | Use `bd init --server` instead of `bd init` (required on Windows)        |
| MCP not appearing in Cursor       | Restart Cursor after adding `.cursor/mcp.json`                           |
| Messages not routing              | Check agent IDs match (`whoami`) and both agents are on the same channel |
| Inbox shows other pair's messages | Use `set_channel` to isolate conversations                               |


