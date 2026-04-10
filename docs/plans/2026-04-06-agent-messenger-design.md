# Agent Messenger: Cursor <-> Claude Code Communication

**Date:** 2026-04-06
**Status:** Design
**Repo:** New standalone repo (not Kestrel — risk isolation)

---

> **Handoff note for receiving agent:** This is a self-contained design and implementation plan. Start by reading the entire document, then execute the Implementation Plan starting at Phase 0. The project is a **new repo** — it does not live inside Kestrel. If the repo has not been created yet, Phase 0 Step 0a has the commands. If it already exists and you're in it, skip to Phase 1. The host machine is **Windows 10 with PowerShell** — all commands must work in that environment.

---

## Problem

When running two AI agents side-by-side — a Cursor agent (Opus) and Claude Code (CC) in a terminal — there is no clean way for them to communicate. Today, the human must manually copy context between agents: reading output from one, pasting it into the other, and explaining what the other agent said or produced.

Desired workflows that currently require manual relay:

1. **Opus writes a design** → CC should read it and brainstorm improvements
2. **CC writes a spec** → Opus should review it as a code architect and find edge cases
3. **Either agent hits a blocker** → the other agent should be asked for help
4. **Session handoff** → one agent wraps up, the other picks up with full context

## Approach

Build a lightweight **MCP server** ("agent-messenger") that provides high-level messaging tools, backed by **Beads** (`steveyegge/beads`) for persistent, version-controlled storage.

Both Cursor and Claude Code are MCP clients. Both connect to the same `agent-messenger` MCP server. The server translates simple messaging operations (`send_message`, `check_inbox`, `reply`) into Beads CLI calls (`bd create --type msg`, `bd list`, etc.).

### Why This Architecture

**Why Beads as the storage layer (instead of raw files or SQLite):**

- Beads is a Dolt-powered graph issue tracker designed for AI agent workflows
- Messages are version-controlled, threaded (via `replies_to` graph links), and persistent across sessions
- `bd prime` injects context at session start (~1-2k tokens) — acts as a natural trigger for discovering messages
- Hash-based IDs prevent collisions in multi-agent writes
- Compaction system prevents old messages from bloating context windows
- Stealth mode (`bd init --stealth`) keeps the DB local without touching git
- Open source, free, runs entirely locally, no external service
- Already has Claude Code hooks and Cursor rules integrations

**Why an MCP layer on top of Beads (instead of using `beads-mcp` directly):**

- `beads-mcp` exposes the full `bd` CLI — general-purpose issue tracking, not messaging
- Agents would need to know Beads internals: `--type msg`, `--thread`, `--deps replies_to:bd-XXXX`, label conventions
- A messaging MCP provides a clean abstraction: `send_message(to, subject, body)` — no Beads knowledge required
- Agent identity is handled by the MCP config, not by the agent itself
- Inbox filtering is automatic (the MCP knows who's asking)
- Publishable as a reusable open-source tool for anyone running Cursor + Claude Code

### Architecture

```
┌─────────────────┐         ┌──────────────────────────┐         ┌─────────────────┐
│  Cursor (Opus)  │         │   agent-messenger MCP    │         │  Claude Code    │
│                 │◄──MCP──►│                          │◄──MCP──►│  (terminal)     │
│  send_message() │  stdio  │  Tools:                  │  stdio  │  check_inbox()  │
│  check_inbox()  │         │   - send_message         │         │  reply()        │
│  reply()        │         │   - check_inbox          │         │  send_message() │
│  get_thread()   │         │   - reply                │         │  get_thread()   │
└─────────────────┘         │   - get_thread           │         └─────────────────┘
                            │   - list_conversations   │
                            │   - mark_read            │
                            │   - whoami               │
                            │                          │
                            │  Internals:              │
                            │   - Agent identity from  │
                            │     config (per-instance)│
                            │   - Translates to bd CLI │
                            │   - Labels for routing   │
                            │   - replies_to for       │
                            │     threading            │
                            │                          │
                            │  ┌────────────────────┐  │
                            │  │  Beads (bd CLI)     │  │
                            │  │  .beads/ Dolt DB    │  │
                            │  │  --type msg         │  │
                            │  │  --thread           │  │
                            │  │  graph links        │  │
                            │  └────────────────────┘  │
                            └──────────────────────────┘
```

Transport: **stdio** (MCP server starts on demand when either agent needs it, no long-running process). Both agents connect to the same MCP server binary but with different `--agent-id` flags.

### MCP Tool Definitions

```typescript
// Send a message to another agent
send_message(params: {
  to: string;           // target agent id, e.g. "claude-code" or "cursor-opus"
  subject: string;      // short summary
  body: string;         // full message content
  context_files?: string[];  // paths to files the recipient should read
  action?: string;      // what the recipient should do: "review", "brainstorm", "implement", "reply"
  priority?: "normal" | "urgent";
}) => { message_id: string; status: "sent" }

// Check for unread messages addressed to this agent
check_inbox(params?: {
  include_read?: boolean;  // default false
}) => { messages: Array<{ id, from, subject, body, context_files, action, priority, timestamp }> }

// Reply to a specific message (auto-threads via replies_to)
reply(params: {
  message_id: string;   // the message being replied to
  body: string;
  context_files?: string[];
}) => { message_id: string; status: "sent" }

// Get a full conversation thread
get_thread(params: {
  message_id: string;   // any message in the thread
}) => { messages: Array<...> }  // ordered chronologically

// List all conversations this agent is part of
list_conversations(params?: {
  status?: "open" | "closed" | "all";
}) => { conversations: Array<{ thread_id, subject, last_message, unread_count }> }

// Mark a message as read
mark_read(params: {
  message_id: string;
}) => { status: "ok" }

// Get this agent's identity (useful for debugging)
whoami() => { agent_id: string; agent_name: string }
```

### Internal Mapping: MCP Tool → Beads CLI

| MCP Tool | Beads CLI |
|---|---|
| `send_message(to, subject, body)` | `bd create "<subject>" --type msg --json --description "<body>" --labels "to:<to>,from:<self>,unread"` |
| `check_inbox()` | `bd list --type msg --label "to:<self>,unread" --status open --json` |
| `reply(message_id, body)` | `bd create "Re: <subject>" --type msg --json --description "<body>" --labels "to:<original_from>,from:<self>,unread" --deps replies_to:<message_id>` |
| `mark_read(message_id)` | `bd update <message_id> --remove-label unread --json` |
| `get_thread(message_id)` | `bd show <message_id> --json` + follow `replies_to` links |
| `list_conversations()` | `bd list --type msg --label "to:<self>" --json` + group by thread root |

### Agent Registration

Each agent connects to the MCP with its identity configured at registration time:

**Cursor** (in Cursor MCP settings or `.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "agent-messenger": {
      "command": "node",
      "args": ["path/to/agent-messenger/dist/index.js", "--agent-id", "cursor-opus"],
      "transport": "stdio"
    }
  }
}
```

**Claude Code** (in `.mcp.json` or `~/.claude.json`):
```json
{
  "mcpServers": {
    "agent-messenger": {
      "command": "node",
      "args": ["path/to/agent-messenger/dist/index.js", "--agent-id", "claude-code"],
      "transport": "stdio"
    }
  }
}
```

### Trigger Mechanism

Neither agent can truly "push" to the other. The MCP solves this with conventions:

1. **Claude Code**: Add a `SessionStart` hook (via `bd setup claude` or manually) that runs `check_inbox`. CC sees pending messages when starting a session or after compaction.
2. **Cursor**: Add a `.cursor/rules/agent-messenger.mdc` rule: "At the start of each turn, if the user mentions messages/inbox/check, call `check_inbox`. Periodically mention if there are unread messages."
3. **Human shortcut**: User says "check messages" to either agent — minimal effort, 2 words.

This is the same limitation every approach has. The MCP makes the check trivial (one tool call) rather than requiring file path knowledge or CLI syntax.

## Implementation Plan

### Phase 0: Create Repo & Project Setup

The test project lives in its own GitHub repo, completely separate from Kestrel.

**Step 0a — Create the GitHub repo and clone it:**

```powershell
# From any directory (e.g. C:\Users\wolfe\Dev)
gh repo create agent-messenger --public --clone --description "MCP server for AI agent-to-agent messaging, backed by Beads"
cd agent-messenger
```

**Step 0b — Open in a new Cursor window:**

In Cursor: File → New Window → "Clone Repo" → paste `https://github.com/wolfe/agent-messenger` (or use "Open Project" if already cloned locally to `C:\Users\wolfe\Dev\agent-messenger`).

**Step 0c — Initialize the project structure:**

```powershell
# Initialize Node/TypeScript project
npm init -y
# Install core dependencies
npm install @modelcontextprotocol/sdk
npm install -D typescript @types/node
npx tsc --init
```

Create the directory structure:
```
agent-messenger/
├── src/
│   ├── index.ts          # MCP server entry point
│   ├── tools/            # One file per MCP tool
│   ├── beads.ts          # bd CLI wrapper
│   └── config.ts         # Agent ID, defaults
├── docs/
│   └── test-design.md    # Dummy design doc for testing handoff workflows
├── package.json
├── tsconfig.json
├── CLAUDE.md             # Instructions for Claude Code in this repo
├── AGENTS.md             # Instructions for Cursor agents in this repo
└── README.md
```

**Step 0d — Install Beads and initialize:**

```powershell
# Install Beads CLI (pick one method)
npm install -g @beads/bd          # via npm
# OR: curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash

# Verify it works on Windows/PowerShell
bd version

# Initialize Beads in the project (stealth = no git hook installation)
bd init --stealth

# Add .beads/ to .gitignore
echo ".beads/" >> .gitignore
```

**Step 0e — Copy this design doc into the new repo and create a test fixture:**

```powershell
# Copy the design doc so it lives in the new repo (not just Kestrel)
mkdir docs\plans
# Copy from Kestrel (adjust path if needed):
copy "C:\Users\wolfe\Dev\Kestrel\docs\plans\2026-04-06-agent-messenger-design.md" docs\plans\
```

Also write `docs/test-design.md` with a short fake design (a few paragraphs about a made-up feature). This gives agents something to "review" when testing the messaging workflow.

**Step 0f — Create CLAUDE.md for this repo:**

```markdown
# CLAUDE.md — Agent Messenger Test Repo

## What This Is
A test repo for building an MCP server that enables Cursor and Claude Code agents to send messages to each other, backed by Beads for persistent storage.

## Design Doc
Read `docs/plans/agent-messenger-design.md` for the full architecture and implementation plan. Follow it phase by phase.

## Commands
- `npm run build` — compile TypeScript
- `npm test` — run tests
- `bd list --type msg --json` — see all messages in Beads
- `bd prime` — see context summary including pending messages
```

### Phase 1: Validate Beads Messaging Primitives (30 min)

Before writing any MCP code, confirm Beads' messaging works on Windows/PowerShell:

```powershell
bd create "Test message from human" --type msg --json
bd list --type msg --json
bd create "Reply to test" --type msg --json --deps replies_to:<id-from-above>
bd show <id> --json
bd prime
```

**Exit criteria:** Messages create, thread, list, and display correctly. `bd prime` surfaces them. If this fails on Windows, stop and reassess.

### Phase 2: Build the MCP Server (half day)

**Tech stack:**
- TypeScript + Node.js
- `@modelcontextprotocol/sdk` for MCP protocol
- `child_process.execSync` or `execa` to shell out to `bd` CLI
- `--agent-id` CLI flag parsed at startup

**File structure:**
```
agent-messenger/
├── src/
│   ├── index.ts          # MCP server entry point, tool registration
│   ├── tools/
│   │   ├── send-message.ts
│   │   ├── check-inbox.ts
│   │   ├── reply.ts
│   │   ├── get-thread.ts
│   │   ├── list-conversations.ts
│   │   ├── mark-read.ts
│   │   └── whoami.ts
│   ├── beads.ts          # bd CLI wrapper (exec + parse JSON output)
│   └── config.ts         # Agent ID, beads dir, defaults
├── package.json
├── tsconfig.json
└── README.md
```

**Implementation order:**
1. `config.ts` — parse `--agent-id`, resolve `.beads` directory
2. `beads.ts` — wrapper that runs `bd <command> --json` and parses output
3. `send-message.ts` + `check-inbox.ts` — minimum viable messaging
4. `index.ts` — MCP server setup with tool registration
5. Test manually: run the MCP server, call tools via `mcp-cli` or directly
6. `reply.ts` + `get-thread.ts` — threading support
7. `mark-read.ts` + `list-conversations.ts` + `whoami.ts` — polish

### Phase 3: Integration Test (1-2 hours)

1. Register the MCP in Cursor settings (agent-id: `cursor-opus`)
2. Register the MCP in Claude Code `.mcp.json` (agent-id: `claude-code`)
3. **Test workflow A**: Cursor sends a message → human tells CC "check messages" → CC reads it, acts, replies → human tells Cursor "check messages" → Cursor reads reply
4. **Test workflow B**: CC sends a design review request → Cursor reads it, reviews, replies with findings
5. **Test workflow C**: Back-and-forth thread (3+ messages)

**Exit criteria:** Both agents can send, receive, and reply to messages using only MCP tool calls. No raw file manipulation or Beads CLI knowledge needed by the agents.

### Phase 4: Bring to Kestrel (15 min, once validated)

1. Install Beads in Kestrel: `bd init --stealth`
2. Add `.beads/` to `.gitignore`
3. Register `agent-messenger` MCP in both Cursor and Claude Code configs
4. Add `agent-messenger.mdc` rule to `.cursor/rules/`
5. Test one real handoff (Opus writes a design, CC reviews it)

### Phase 5: Polish & Publish (optional, later)

- Add README with setup instructions
- Publish to npm as `@kestrel/agent-messenger` or similar
- Add SessionStart hook installer script
- Add Cursor rule installer script
- Consider: should the MCP also expose Beads task tracking tools (bd ready, bd update --claim) alongside messaging?

## Open Questions

1. **Beads on Windows**: The README lists Windows support but it's less tested. Phase 1 validates this before any MCP work. If it's broken, fall back to a file-based storage layer inside the MCP (JSON files instead of Dolt).

2. **Concurrent access**: Both agents could call `bd` simultaneously. Beads uses file locking in embedded mode (single-writer). Is this sufficient, or do we need server mode (`bd init --server`)? Test in Phase 3.

3. **Context file handling**: When `send_message` includes `context_files: ["docs/plans/foo.md"]`, should the MCP just pass the paths, or should it inline the file contents into the message body? Paths are lighter but require the recipient to read them. Inlining is heavier but self-contained.

4. **Message lifecycle**: When should messages be closed? Options: (a) auto-close on `mark_read`, (b) auto-close on `reply`, (c) explicit close by sender, (d) never close (let compaction handle it). Leaning toward (b) — a reply indicates the message was handled.

5. **Scaling beyond 2 agents**: The design supports N agents via the `to` label. But do we need broadcast/channel semantics (send to all agents)? Not for the initial version, but worth keeping the door open.

6. **Alternative to bd CLI shelling**: Instead of `child_process.exec("bd ...")`, could use Beads' MCP server (`beads-mcp`) as a library. But shelling out to `bd` is simpler, more debuggable, and avoids version coupling. Start with shell, optimize later if needed.

7. **Multi-agent scaling (3+ agents)**: The design already supports N agents — each gets a unique `--agent-id` and messages route via the `to` label. The main concern is concurrent database access: Beads embedded mode is single-writer with file locking, which is fine for 2 agents but could cause lock contention with 3+. The fix is to use Beads **server mode** (`bd init --server --stealth`) which runs a Dolt SQL server supporting multiple concurrent writers. For the initial 2-agent test, embedded mode is sufficient. If scaling to 3+, swap to server mode and consider adding `broadcast(subject, body)` and `list_agents()` tools to the MCP.

## Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| Beads (`bd` CLI) | v1.0.0+ | Storage layer (Dolt-backed message persistence) |
| Node.js | 18+ | MCP server runtime |
| `@modelcontextprotocol/sdk` | latest | MCP protocol implementation |
| TypeScript | 5.x | Language |

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Beads doesn't work on Windows/PowerShell | Phase 1 validates before any MCP code is written. Fallback: swap storage to JSON files. |
| Concurrent bd access causes corruption | Test in Phase 3. Fallback: use Beads server mode or add a mutex in the MCP. |
| MCP server startup is slow (stdio) | Measure in Phase 3. Beads CLI startup is typically <200ms. |
| Beads CLI output format changes | Pin Beads version. Use `--json` for structured output. |
| Workflow isn't actually useful | Phase 1-3 use a throwaway test repo. Zero risk to Kestrel until Phase 4. |

## Success Criteria

- [ ] Both agents can send and receive messages using only MCP tool calls
- [ ] Messages persist across sessions (agent restarts, context compaction)
- [ ] Threading works (3+ message conversation is reconstructable)
- [ ] Agent identity is automatic (agents don't need to self-identify)
- [ ] Setup in a new project takes < 15 minutes
- [ ] No impact on Kestrel until explicitly brought over in Phase 4
