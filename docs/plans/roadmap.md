# Agent Messenger — Roadmap

**Last updated:** 2026-04-09
**Status:** Active

---

## Completed Work

### Initial build sprint (2026-04-06 to 2026-04-07)

- MCP server with 9 messaging tools: `send_message`, `check_inbox`, `reply`, `get_thread`, `list_conversations`, `mark_read`, `whoami`, `set_channel`, `set_identity`
- Beads-backed persistent storage with Dolt server mode
- Auto-naming identity system (session IDs, base ID routing, runtime rename)
- Channel-based message isolation for multi-agent pairs
- Auto-mark-read on inbox check
- Agent ID validation with suggestions on send
- `--beads-dir` auto-correction (appends `.beads` if missing)
- Cursor rules with auto-polling and shortcuts (`#help` `#cm` `#sm` `#ch` `#id` `#wi`)
- Claude Code skills (`/am` `/cm` `/sm` `/ch` `/id` `/wi`)
- `agent-messenger init` CLI installer
- `agent-messenger doctor` diagnostic tool
- Setup guide and README
- Installed and tested in Kestrel project

### Subsequent work (2026-04-08 to 2026-04-09)

- **Epic 6.2:** Automated test suite — 45 tests via vitest (config parsing, identity system, messaging, integration)
- **Epic 7.1:** `agent-messenger status` CLI — unread counts, recent messages, active agents, channels
- **Epic 7.2:** `agent-messenger log` CLI — chronological message history, agent/channel filters, thread view
- **Epic 8.1:** Task MCP tools — `create_task`, `list_tasks`, `show_task`, `update_task`, `claim_task`, `close_task`
- **Epic 8.2:** Task-message linking — optional `task_id` on `send_message`/`reply`, `refs:` labels, auto-update task notes, linked messages in `show_task`
- **Epic 8.3:** Task shortcuts — `#ct` `#lt` `#st` `#rt` `#la` for Cursor; `/ct` `/lt` `/st` `/rt` `/la` for CC
- **Epic 10.1 (partial):** Lightweight agent presence — `list_agents` tool, presence registration on startup, stale session cleanup
- Smart agent naming with env detection (`claude-code-term-a3`, `cursor-opus-cursor-f2`)
- `--env` flag for explicit environment override
- Removed time-based staleness from presence (open = active, cleanup on startup only)
- Removed user-level `~/.cursor/mcp.json` fallback (was causing duplicate MCP entries)
- `send_message` `worktree` field (suggestion to recipient, not automatic)

---

## Phase 6: Publish & Harden

**Goal:** Make agent-messenger installable by anyone, with confidence it works.

### Epic 6.1: npm Publish

Publish the package to npm so `npm install -g agent-messenger` works globally. This eliminates hardcoded paths in MCP configs and makes `agent-messenger init` truly portable.

| Task | Description | Priority |
|------|-------------|----------|
| 6.1.1 | Audit `package.json`: add `files` field, verify `bin` entry, set `engines`, add author | P1 |
| 6.1.2 | Add `.npmignore` to exclude `.beads/`, `docs/plans/`, test fixtures | P1 |
| 6.1.3 | Update `init.ts` to detect global install vs local clone and resolve server path accordingly | P1 |
| 6.1.4 | Test full cycle: `npm pack` → install from tarball → `agent-messenger init` → verify | P1 |
| 6.1.5 | `npm publish` to registry | P1 |
| 6.1.6 | Verify: fresh machine (or clean env) can `npm install -g agent-messenger && agent-messenger init` | P1 |

### Epic 6.2: Automated Tests ✅

Build a test suite that validates core functionality and prevents regressions.

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| 6.2.1 | Install vitest, configure for ESM/TypeScript | P1 | ✅ |
| 6.2.2 | Unit tests: config parsing (`--agent-id`, `--beads-dir` auto-append, `--no-auto-id`, env var fallback) | P1 | ✅ |
| 6.2.3 | Unit tests: identity system (session ID generation, `set_identity` state change, `whoami` output) | P1 | ✅ |
| 6.2.4 | Unit tests: message formatting, label construction, channel label generation | P2 | ✅ |
| 6.2.5 | Integration tests: temp `.beads` dir → send → inbox → reply → thread → mark_read cycle | P2 | ✅ |
| 6.2.6 | CLI tests: `init --dry-run` produces expected file list, `doctor` reports pass on healthy setup | P2 | ✅ |
| 6.2.7 | Add `npm test` script, CI consideration (needs `bd` + `dolt` on PATH) | P2 | ✅ |

### Epic 6.3: Cross-Platform Validation

Confirm agent-messenger works on macOS (and Linux if possible).

| Task | Description | Priority |
|------|-------------|----------|
| 6.3.1 | Test `bd init --server` vs `bd init` (embedded) on macOS — embedded may work without CGO issue | P2 |
| 6.3.2 | Verify `agent-messenger init` path handling on macOS (forward slashes, `~` expansion) | P2 |
| 6.3.3 | Test full round-trip: init → send → receive on macOS | P2 |
| 6.3.4 | Document any platform-specific notes in setup guide | P3 |

---

## Phase 7: Human Visibility & CLI

**Goal:** Give the human operator direct visibility into message state without needing to ask an agent.

### Epic 7.1: `agent-messenger status` Command ✅

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| 7.1.1 | Implement `status` subcommand: show unread counts per agent, latest message summaries | P1 | ✅ |
| 7.1.2 | Show active channels and which agents are on each | P2 | ✅ |
| 7.1.3 | Show agent session IDs (who's been active recently based on message timestamps) | P2 | ✅ |
| 7.1.4 | Color-coded terminal output (unread = bold, urgent = red) | P3 | Open |

### Epic 7.2: `agent-messenger log` Command ✅

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| 7.2.1 | Implement `log` subcommand: display recent message history in chronological order | P2 | ✅ |
| 7.2.2 | Filter by agent, channel, time range | P3 | ✅ (agent, channel; time range deferred) |
| 7.2.3 | Thread view mode (show conversation trees) | P3 | ✅ |

---

## Phase 8: Beads Task Integration

**Goal:** Expose Beads task tracking through agent-messenger so agents can create, claim, update, and query tasks as part of their workflow — linking task state to message threads.

### Epic 8.1: Task MCP Tools ✅

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| 8.1.1 | Design tool schemas: `create_task`, `list_tasks`, `show_task`, `update_task`, `claim_task`, `close_task` | P1 | ✅ |
| 8.1.2 | Implement `create_task`: map to `bd create` with support for `--description`, `--design-file`, `--context`, `--parent`, `--deps`, `--priority`, `--labels`, `--due`, `--estimate` | P1 | ✅ |
| 8.1.3 | Implement `list_tasks`: map to `bd list` with filters (status, assignee, priority, label, parent, ready-only) | P1 | ✅ |
| 8.1.4 | Implement `show_task`: map to `bd show` with `--long` and `--children` support | P1 | ✅ |
| 8.1.5 | Implement `update_task`: map to `bd update` for status, notes, description, labels, priority, assignee | P1 | ✅ |
| 8.1.6 | Implement `claim_task`: map to `bd update --claim` (atomic assign + in_progress) | P2 | ✅ |
| 8.1.7 | Implement `close_task`: map to `bd close` | P2 | ✅ |
| 8.1.8 | Implement `create_epic`: map to `bd create --type epic` for phased planning | P2 | Open |

### Epic 8.2: Task ↔ Message Linking ✅

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| 8.2.1 | Add optional `task_id` field to `send_message` and `reply` — attaches `refs:<task_id>` label | P2 | ✅ |
| 8.2.2 | When replying with a task reference, auto-update task notes with message summary | P3 | ✅ |
| 8.2.3 | `show_task` includes linked messages if any exist | P3 | ✅ |

### Epic 8.3: Task Shortcuts ✅

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| 8.3.1 | Cursor shortcuts: `#ct` create task, `#lt` list tasks, `#st` show task, `#rt` ready tasks, `#la` list agents | P2 | ✅ |
| 8.3.2 | CC skills: `/ct`, `/lt`, `/st`, `/rt`, `/la` | P2 | ✅ |
| 8.3.3 | Update `#help` / `/am` to include task commands | P2 | ✅ |

---

## Phase 9: Workflow Automation

**Goal:** Reduce the human-in-the-loop overhead for common multi-agent workflows.

### Epic 9.1: Context Inlining

| Task | Description | Priority |
|------|-------------|----------|
| 9.1.1 | Add `inline_context` boolean to `send_message` — when true, read `context_files` and embed content in message body | P2 |
| 9.1.2 | Size guard: warn or truncate if inlined content exceeds a threshold (e.g. 50k chars) | P3 |

### Epic 9.2: Workflow Templates

| Task | Description | Priority |
|------|-------------|----------|
| 9.2.1 | Design workflow schema: named sequences of steps with agent assignments and transitions | P2 |
| 9.2.2 | Implement `#workflow design-review` — Cursor brainstorms → sends to CC → CC reviews → sends reply → Cursor synthesizes | P3 |
| 9.2.3 | Implement `#workflow code-review` — Cursor generates diff → sends to CC → CC reviews → replies with findings | P3 |
| 9.2.4 | Store workflow state in Beads so session restarts can resume mid-workflow | P3 |

### Epic 9.3: Approval Gates

| Task | Description | Priority |
|------|-------------|----------|
| 9.3.1 | Add `pending_approval` message status — agent marks output as needing human sign-off | P3 |
| 9.3.2 | `agent-messenger approve <id>` CLI command for human to approve from terminal | P3 |
| 9.3.3 | `#approve` / `/approve` shortcuts for agents to check and relay approval status | P3 |

---

## Phase 10: Scale & Polish

**Goal:** Handle complex multi-agent topologies and keep the system clean over time.

### Epic 10.1: Presence & Discovery (partial ✅)

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| 10.1.1 | Presence registration on startup, stale session cleanup when same baseId re-registers | P3 | ✅ |
| 10.1.2 | `list_agents` MCP tool: shows which agents are currently active (open presence records) | P3 | ✅ |
| 10.1.3 | `agent-messenger status` shows live/stale agents | P3 | ✅ |
| 10.1.4 | Periodic heartbeat (not just on startup) | P3 | Open |
| 10.1.5 | Deregister presence on clean shutdown | P3 | Open |

### Epic 10.2: Message Lifecycle

| Task | Description | Priority |
|------|-------------|----------|
| 10.2.1 | Auto-close messages on reply (configurable) | P3 |
| 10.2.2 | Message TTL: ephemeral messages that expire after N hours | P3 |
| 10.2.3 | Compaction: archive old closed threads to reduce `bd list` noise | P3 |

### Epic 10.3: Multi-Agent Fan-Out

| Task | Description | Priority |
|------|-------------|----------|
| 10.3.1 | `broadcast` tool: send a message to all agents (or all on a channel) | P3 |
| 10.3.2 | Fan-out pattern: split a plan into N tasks, assign to available agents, collect results | P4 |
| 10.3.3 | Integrate with Beads `--waits-for` gate pattern for fan-out/fan-in orchestration | P4 |

---

## Priority Legend

| Priority | Meaning |
|----------|---------|
| P1 | Do next — required for the tool to be usable by others |
| P2 | Important — high value, do soon after P1 |
| P3 | Nice to have — meaningful improvement, schedule when bandwidth allows |
| P4 | Future — exploratory, design needed before implementation |
