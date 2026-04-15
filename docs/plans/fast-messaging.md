# Fast Messaging: File-Based Message Store

**Status:** Plan  
**Date:** 2026-04-15  
**Problem:** Sending a message takes ~6.6s because every operation shells out to `bd` (Beads CLI), which commits to Dolt on every write.

## Design Summary

Replace the Beads/Dolt backend for **messages only** with a local file-based store. Tasks, epics, presence, and workflow checkpoints stay in Beads unchanged.

**Target performance:**
| Operation | Current | Target |
|---|---|---|
| send_message | ~6.6s | <15ms |
| check_inbox | ~1.2s + 0.6s/unread | <10ms |
| reply | ~7.2s | <15ms |
| mark_read | ~0.6s | <5ms |
| get_thread | ~0.6s/message | <10ms total |
| list_conversations | unbounded | <10ms |

## Storage Layout

```
<projectRoot>/.am/
  index.json          # compact metadata array — no message bodies
  messages/
    <id>.body         # raw body text per message (can be large)
  index.lock/         # directory-based atomic lock
```

### Why This Structure

Messages can be several pages long (code reviews, specs, implementation plans). Separating metadata from body means:

- **Inbox check** reads one small file (`index.json`), never touches body files
- **Reading a specific message** loads one body file on demand
- **Sending** writes two files: append to index + write body
- No operation ever needs to read all bodies at once

### index.json Schema

```json
[
  {
    "id": "msg-a3f2e710-8b1c",
    "to": "claude-code",
    "from": "cursor-a3f2",
    "subject": "Review auth implementation",
    "channel": null,
    "action": "review",
    "priority": "normal",
    "unread": true,
    "timestamp": "2026-04-15T20:13:01Z",
    "reply_to": null,
    "thread_id": "msg-a3f2e710-8b1c",
    "context_files": ["src/auth.ts"],
    "task_id": null,
    "body_size": 14832
  }
]
```

Each entry is ~250 bytes. 1,000 messages = ~250KB index. Easily fits in memory.

Fields:
- **id**: `msg-<8-hex-random>` — short, unique, no collisions at this scale
- **to/from/subject/channel/action/priority**: same semantics as current labels
- **unread**: boolean (replaces the `unread` label in Beads)
- **timestamp**: ISO 8601 creation time
- **reply_to**: ID of parent message (null for root messages)
- **thread_id**: ID of the root message in the thread (set on creation, never changes)
- **context_files**: array of file paths (pulled out of body, stored as first-class field)
- **task_id**: optional Beads task reference for cross-store linking
- **body_size**: byte length of body file (lets inbox show "3.2KB message" without reading it)

### Body Files

`messages/<id>.body` — raw text, no JSON wrapper. This keeps large message bodies simple to read and write, avoids double-escaping, and means the file is directly inspectable with `cat` or any text editor.

### Message ID Generation

```
msg-<8 hex chars from crypto.randomBytes(4)>
```

Example: `msg-a3f2e710`. Short enough to type, random enough to never collide at the scale of agent messaging (birthday problem: 50% collision chance at ~65,000 messages).

### Threading Model

Current Beads threading uses recursive `replies_to` dependency traversal — each `get_thread` call does N sequential `bd show` calls to walk the chain.

New model: **flat thread grouping via `thread_id`**.

- New message (not a reply): `thread_id = id`
- Reply: `thread_id = parent.thread_id` (copied from parent's index entry, no lookup needed)
- Get thread: filter index where `thread_id === X`, sort by timestamp. One pass, no recursion.
- List conversations: group by `thread_id`, compute unread counts. One pass.

This turns O(N * subprocess) into O(1 file read + filter).

## Concurrency

Two agents (Cursor + CC) may write at the same time. The lock protocol:

1. **Acquire**: `mkdirSync('.am/index.lock')` — atomic on all platforms
2. **Read**: parse `index.json`
3. **Mutate**: append entry or flip `unread` flag
4. **Write**: write to `index.tmp.json`, then rename to `index.json`
5. **Release**: `rmdirSync('.am/index.lock')`

The lock is held for <5ms (read JSON, mutate in memory, write file). Contention is nearly impossible with 2–5 agents and human-in-the-loop pacing.

**Stale lock recovery**: If `index.lock/` exists and is older than 10 seconds, remove it and proceed. This handles crash-during-write.

**Body files need no locking** — they're write-once, never modified.

## Operations

### send_message
1. Generate ID (`msg-<random>`)
2. Write body to `messages/<id>.body`
3. Lock index
4. Append metadata entry to index (thread_id = id)
5. Write index, release lock
6. Return { id, status: "sent" }

Presence check (getKnownAgents) stays as-is — it still reads from Beads since presence records are chores, not messages.

### check_inbox
1. Read index.json (no lock needed for reads)
2. Filter: `to` matches agentId or baseId, `channel` matches, `unread` if requested
3. For each matching entry, read `messages/<id>.body`
4. If auto_mark_read: lock index, flip `unread` flags, write index, release lock
5. Return formatted messages

Note: reading N body files for N unread messages is fine — it's N filesystem reads (~1ms each) vs. N subprocess spawns (~600ms each). Even 20 unread multi-page messages would take ~20ms total.

### reply
1. Read parent's index entry (by message_id) — single array lookup
2. Generate ID, set `reply_to = parent.id`, `thread_id = parent.thread_id`
3. Write body file + append to index (same as send)
4. If task_id: also update the Beads task via `bdExec` (this is the only Beads call, and it's optional/best-effort)

### mark_read
1. Lock index
2. Find entry by ID, set `unread = false`
3. Write index, release lock

### get_thread
1. Read index.json
2. Filter where `thread_id === targetThreadId`
3. Sort by timestamp
4. Load body files for each message
5. Return thread

### list_conversations
1. Read index.json
2. Group by `thread_id`
3. For each group: count messages, count unread, find latest
4. Return summaries (no body loading needed)

## Code Changes

### New Files

| File | Purpose |
|---|---|
| `src/message-store.ts` | Core read/write/lock operations for the file store |

### Modified Files

| File | Change |
|---|---|
| `src/tools/send-message.ts` | Call `messageStore.create()` instead of `beads.createMessage()` |
| `src/tools/check-inbox.ts` | Call `messageStore.inbox()` instead of `beads.checkInbox()` |
| `src/tools/reply.ts` | Call `messageStore.reply()` instead of `beads.replyToMessage()` |
| `src/tools/get-thread.ts` | Call `messageStore.thread()` instead of `beads.getThread()` |
| `src/tools/list-conversations.ts` | Call `messageStore.conversations()` instead of `beads.listConversations()` |
| `src/tools/mark-read.ts` | Call `messageStore.markRead()` instead of `beads.markRead()` |
| `src/tools/query-beads.ts` | Route `type: "message"` to message store, other types to Beads |
| `src/cli/status.ts` | Read from `.am/index.json` instead of `bd list --type message` |
| `src/cli/log.ts` | Read from `.am/index.json` + body files |
| `src/cli/init.ts` | Create `.am/messages/` directory during init |
| `src/cli/doctor.ts` | Add health check for `.am/` directory |
| `src/config.ts` | Add `messageDir` field to Config |
| `src/index.ts` | Initialize message store directory on startup |
| `src/beads.ts` | Remove message-specific functions (createMessage, checkInbox, replyToMessage, markRead, getThread, listConversations, showMessage, findThreadRoot, collectThread, findRootId) — keep task/presence/workflow functions |

### Unchanged

Everything task-related: `create-task.ts`, `list-tasks.ts`, `show-task.ts`, `update-task.ts`, `claim-task.ts`, `close-task.ts`, `manage-deps.ts`, `blocked-tasks.ts`, `project-stats.ts`, presence functions in `beads.ts`, workflow functions.

## Message Store API

```typescript
// src/message-store.ts

interface MessageMeta {
  id: string;
  to: string;
  from: string;
  subject: string;
  channel: string | null;
  action: string | null;
  priority: "normal" | "urgent";
  unread: boolean;
  timestamp: string;
  reply_to: string | null;
  thread_id: string;
  context_files: string[];
  task_id: string | null;
  body_size: number;
}

interface Message extends MessageMeta {
  body: string;
}

class MessageStore {
  constructor(storeDir: string)    // storeDir = <projectRoot>/.am

  // Write operations (acquire lock internally)
  create(params: { to, from, subject, body, ... }): MessageMeta
  markRead(id: string): void
  markAllRead(ids: string[]): void  // batch mark-read in one lock acquisition

  // Read operations (no lock needed)
  inbox(agentId: string, baseId: string, opts?: { channel?, includeRead? }): Message[]
  readBody(id: string): string
  thread(messageId: string): Message[]
  conversations(agentId: string, opts?: { status? }): ConversationSummary[]
  find(id: string): MessageMeta | undefined
  query(filter: { from?, to?, channel?, limit?, sort? }): MessageMeta[]

  // Maintenance
  prune(opts?: { olderThan?: number, readOnly?: boolean }): number
}
```

## Migration

### From Beads → File Store

No automated migration needed. Existing messages in Beads are historical artifacts — they can still be queried directly via `bd list --type message` if someone wants old history.

The transition is clean:
1. Deploy new version
2. New messages go to `.am/`
3. Old messages stay in Beads (read-only, accessible via `bd` CLI)
4. Optional: add a `agent-messenger migrate` command that copies old Beads messages into `.am/` for a unified history

### .gitignore

Add to project `.gitignore`:
```
.am/
```

Messages are ephemeral project-local state. They should not be committed.

## Cleanup / Rotation

The index will grow over time. Strategies:

1. **On startup**: if index has >500 entries, prune read messages older than 7 days
2. **Manual**: `agent-messenger prune` CLI command
3. **Auto**: prune on every 10th write (amortized, nearly free)

Pruning removes the index entry and deletes the corresponding `.body` file.

## What We Lose

1. **`bd list --type message`** no longer shows new messages — use `agent-messenger log` instead
2. **`bd prime`** won't mention unread messages — the MCP server's `check_inbox` tool is the canonical way to check anyway
3. **Dolt history** of messages — but nobody was using this
4. **Remote sync** of messages via `bd dolt push` — messages are project-local by design

## What We Gain

1. **600x faster sends** (~6.6s → ~10ms)
2. **100x faster inbox checks** (~1.2s → ~10ms)
3. **Instant threading** — no recursive subprocess calls
4. **Zero external dependencies** — no `bd` binary needed for messaging
5. **Predictable performance** — no Dolt server health dependency
6. **Separation of concerns** — messages have their own access patterns, now they have their own store

## Implementation Order

1. `src/message-store.ts` — the core store with tests
2. Wire up `send-message.ts` + `check-inbox.ts` (the two hottest paths)
3. Wire up `reply.ts`, `mark-read.ts`, `get-thread.ts`, `list-conversations.ts`
4. Update `query-beads.ts` to route `type: "message"`
5. Update CLI commands (`status.ts`, `log.ts`)
6. Update `init.ts` and `doctor.ts`
7. Update `config.ts` to include `messageDir`
8. Clean up `beads.ts` — remove dead message functions
9. Tests for concurrency (two writers), large bodies, edge cases
