# Fast Messaging Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Beads/Dolt backend for messages with a local file-based store so sends drop from ~6.6s to <15ms.

**Architecture:** Messages get their own file store (`<projectRoot>/.am/`) with a metadata index (`index.json`) separated from body files (`messages/<id>.body`). Tasks, epics, presence, and workflow checkpoints stay in Beads unchanged. A directory-based lock (`mkdirSync`) provides safe concurrent access.

**Tech Stack:** Node.js fs (no new dependencies), vitest for tests, existing Config/tool handler patterns.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/message-store.ts` | **Create** | Core store: index I/O, locking, CRUD, queries |
| `tests/message-store.test.ts` | **Create** | Unit tests for the store (no beads/bd needed) |
| `tests/integration.test.ts` | **Modify** | Add file-store integration test alongside existing Beads tests |
| `src/tools/send-message.ts` | **Modify** | Use `MessageStore` instead of `beads.createMessage` |
| `src/tools/check-inbox.ts` | **Modify** | Use `MessageStore` instead of `beads.checkInbox` |
| `src/tools/reply.ts` | **Modify** | Use `MessageStore` instead of `beads.replyToMessage` |
| `src/tools/get-thread.ts` | **Modify** | Use `MessageStore` instead of `beads.getThread` |
| `src/tools/list-conversations.ts` | **Modify** | Use `MessageStore` instead of `beads.listConversations` |
| `src/tools/mark-read.ts` | **Modify** | Use `MessageStore` instead of `beads.markRead` |
| `src/tools/query-beads.ts` | **Modify** | Route `type: "message"` to `MessageStore` |
| `src/config.ts` | **Modify** | Add `messageDir` to `Config` interface |
| `src/index.ts` | **Modify** | Create `.am/` dirs on startup, pass `messageDir` to tools |
| `src/cli/init.ts` | **Modify** | Create `.am/messages/` during init |
| `src/cli/status.ts` | **Modify** | Read from `.am/index.json` |
| `src/cli/log.ts` | **Modify** | Read from `.am/index.json` + body files |
| `src/beads.ts` | **Modify** | Remove dead message functions after migration |

---

## Chunk 1: Core Message Store + Tests

### Task 1: MessageStore — types, ID generation, index I/O

**Files:**
- Create: `src/message-store.ts`
- Test: `tests/message-store.test.ts`

- [ ] **Step 1: Write tests for ID generation and types**

In `tests/message-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MessageStore } from "../src/message-store.js";

describe("MessageStore", () => {
  let tmpDir: string;
  let store: MessageStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "am-store-test-"));
    store = new MessageStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("initialization", () => {
    it("creates store directories on construction", () => {
      const { existsSync } = require("node:fs");
      expect(existsSync(join(tmpDir, "messages"))).toBe(true);
      expect(existsSync(join(tmpDir, "index.json"))).toBe(true);
    });

    it("index.json starts as empty array", () => {
      const { readFileSync } = require("node:fs");
      const data = JSON.parse(readFileSync(join(tmpDir, "index.json"), "utf-8"));
      expect(data).toEqual([]);
    });
  });

  describe("ID generation", () => {
    it("generates IDs matching msg-<hex> pattern", () => {
      const meta = store.create({
        to: "cc", from: "cursor", subject: "test", body: "hello",
      });
      expect(meta.id).toMatch(/^msg-[0-9a-f]{8}$/);
    });

    it("generates unique IDs across calls", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const m = store.create({
          to: "cc", from: "cursor", subject: "test", body: "hello",
        });
        ids.add(m.id);
      }
      expect(ids.size).toBe(50);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/message-store.test.ts`
Expected: FAIL — `Cannot find module '../src/message-store.js'`

- [ ] **Step 3: Implement MessageStore skeleton with types, init, and ID generation**

Create `src/message-store.ts`:

```typescript
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmdirSync, statSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface MessageMeta {
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

export interface Message extends MessageMeta {
  body: string;
}

export interface ConversationSummary {
  thread_id: string;
  subject: string;
  last_message: MessageMeta;
  unread_count: number;
  message_count: number;
}

function generateId(): string {
  return `msg-${randomBytes(4).toString("hex")}`;
}

export class MessageStore {
  private indexPath: string;
  private messagesDir: string;
  private lockDir: string;

  constructor(storeDir: string) {
    this.indexPath = join(storeDir, "index.json");
    this.messagesDir = join(storeDir, "messages");
    this.lockDir = join(storeDir, "index.lock");

    mkdirSync(this.messagesDir, { recursive: true });
    if (!existsSync(this.indexPath)) {
      writeFileSync(this.indexPath, "[]", "utf-8");
    }
  }

  // --- Locking ---

  private acquireLock(timeoutMs = 5000): void {
    const start = Date.now();
    while (true) {
      try {
        mkdirSync(this.lockDir);
        return;
      } catch {
        // Lock exists — check if stale (>10s old)
        try {
          const stat = statSync(this.lockDir);
          if (Date.now() - stat.mtimeMs > 10_000) {
            rmdirSync(this.lockDir);
            continue;
          }
        } catch { /* lock vanished, retry */ }

        if (Date.now() - start > timeoutMs) {
          throw new Error("Failed to acquire message store lock");
        }
        // Spin-wait briefly
        const end = Date.now() + 5;
        while (Date.now() < end) { /* busy wait */ }
      }
    }
  }

  private releaseLock(): void {
    try { rmdirSync(this.lockDir); } catch { /* already gone */ }
  }

  // --- Index I/O ---

  private readIndex(): MessageMeta[] {
    try {
      const raw = readFileSync(this.indexPath, "utf-8");
      return JSON.parse(raw) as MessageMeta[];
    } catch {
      return [];
    }
  }

  private writeIndex(entries: MessageMeta[]): void {
    const tmpPath = this.indexPath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(entries, null, 2), "utf-8");
    const { renameSync } = require("node:fs") as typeof import("node:fs");
    renameSync(tmpPath, this.indexPath);
  }

  // --- Body I/O ---

  private bodyPath(id: string): string {
    return join(this.messagesDir, `${id}.body`);
  }

  readBody(id: string): string {
    return readFileSync(this.bodyPath(id), "utf-8");
  }

  private writeBody(id: string, body: string): void {
    writeFileSync(this.bodyPath(id), body, "utf-8");
  }

  // --- Public API ---

  create(params: {
    to: string;
    from: string;
    subject: string;
    body: string;
    channel?: string | null;
    action?: string | null;
    priority?: "normal" | "urgent";
    context_files?: string[];
    task_id?: string | null;
    reply_to?: string | null;
    thread_id?: string | null;
  }): MessageMeta {
    const id = generateId();
    const body = params.body;

    const meta: MessageMeta = {
      id,
      to: params.to,
      from: params.from,
      subject: params.subject,
      channel: params.channel ?? null,
      action: params.action ?? null,
      priority: params.priority ?? "normal",
      unread: true,
      timestamp: new Date().toISOString(),
      reply_to: params.reply_to ?? null,
      thread_id: params.thread_id ?? id,
      context_files: params.context_files ?? [],
      task_id: params.task_id ?? null,
      body_size: Buffer.byteLength(body, "utf-8"),
    };

    this.writeBody(id, body);

    this.acquireLock();
    try {
      const index = this.readIndex();
      index.push(meta);
      this.writeIndex(index);
    } finally {
      this.releaseLock();
    }

    return meta;
  }
}
```

Note: `renameSync` is imported inline via require in `writeIndex` to avoid duplicating it in the top-level import (it's already destructured from `"node:fs"` but we need to add it). Actually, let's fix that — add `renameSync` to the top-level import destructure instead.

The top import should be:
```typescript
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync,
  rmdirSync, statSync,
} from "node:fs";
```

And `writeIndex` becomes:
```typescript
  private writeIndex(entries: MessageMeta[]): void {
    const tmpPath = this.indexPath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(entries, null, 2), "utf-8");
    renameSync(tmpPath, this.indexPath);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/message-store.test.ts`
Expected: PASS (2 describe blocks, ~4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/message-store.ts tests/message-store.test.ts
git commit -m "feat: add MessageStore skeleton with types, init, ID generation, and locking"
```

---

### Task 2: MessageStore — create, inbox, markRead

**Files:**
- Modify: `src/message-store.ts` (add `inbox`, `markRead`, `markAllRead`, `find`)
- Modify: `tests/message-store.test.ts` (add tests)

- [ ] **Step 1: Write tests for create, inbox, and markRead**

Add to `tests/message-store.test.ts` inside the outer `describe("MessageStore")`:

```typescript
  describe("create", () => {
    it("stores metadata in index and body on disk", () => {
      const meta = store.create({
        to: "claude-code", from: "cursor-a1b2", subject: "Review PR",
        body: "Please review the auth changes",
        action: "review", priority: "urgent",
        context_files: ["src/auth.ts"],
      });

      expect(meta.to).toBe("claude-code");
      expect(meta.from).toBe("cursor-a1b2");
      expect(meta.subject).toBe("Review PR");
      expect(meta.action).toBe("review");
      expect(meta.priority).toBe("urgent");
      expect(meta.unread).toBe(true);
      expect(meta.thread_id).toBe(meta.id);
      expect(meta.reply_to).toBeNull();
      expect(meta.context_files).toEqual(["src/auth.ts"]);
      expect(meta.body_size).toBeGreaterThan(0);

      const body = store.readBody(meta.id);
      expect(body).toBe("Please review the auth changes");
    });

    it("handles large multi-page bodies", () => {
      const largeBody = "x".repeat(100_000);
      const meta = store.create({
        to: "cc", from: "cursor", subject: "Big message", body: largeBody,
      });
      expect(meta.body_size).toBe(100_000);
      expect(store.readBody(meta.id)).toBe(largeBody);
    });

    it("handles special characters in body", () => {
      const body = 'backticks ` quotes " pipes | newlines\n\ttabs\0nulls';
      const meta = store.create({
        to: "cc", from: "cursor", subject: "Special chars", body,
      });
      expect(store.readBody(meta.id)).toBe(body);
    });
  });

  describe("inbox", () => {
    it("returns unread messages addressed to agent", () => {
      store.create({ to: "cc", from: "cursor", subject: "For CC", body: "hi" });
      store.create({ to: "other", from: "cursor", subject: "Not for CC", body: "hi" });

      const inbox = store.inbox("cc", "cc");
      expect(inbox).toHaveLength(1);
      expect(inbox[0]!.subject).toBe("For CC");
      expect(inbox[0]!.body).toBe("hi");
    });

    it("matches both agentId and baseId", () => {
      store.create({ to: "cc", from: "cursor", subject: "To base", body: "a" });
      store.create({ to: "cc-design", from: "cursor", subject: "To session", body: "b" });

      const inbox = store.inbox("cc-design", "cc");
      expect(inbox).toHaveLength(2);
    });

    it("filters by channel when specified", () => {
      store.create({ to: "cc", from: "cursor", subject: "Ch1", body: "a", channel: "ch1" });
      store.create({ to: "cc", from: "cursor", subject: "Ch2", body: "b", channel: "ch2" });
      store.create({ to: "cc", from: "cursor", subject: "No ch", body: "c" });

      const inbox = store.inbox("cc", "cc", { channel: "ch1" });
      expect(inbox).toHaveLength(1);
      expect(inbox[0]!.subject).toBe("Ch1");
    });

    it("excludes read messages by default", () => {
      const m = store.create({ to: "cc", from: "cursor", subject: "Read me", body: "x" });
      store.markRead(m.id);
      const inbox = store.inbox("cc", "cc");
      expect(inbox).toHaveLength(0);
    });

    it("includes read messages when includeRead is true", () => {
      const m = store.create({ to: "cc", from: "cursor", subject: "Read me", body: "x" });
      store.markRead(m.id);
      const inbox = store.inbox("cc", "cc", { includeRead: true });
      expect(inbox).toHaveLength(1);
    });
  });

  describe("markRead", () => {
    it("marks a single message as read", () => {
      const m = store.create({ to: "cc", from: "cursor", subject: "Test", body: "x" });
      expect(store.find(m.id)!.unread).toBe(true);
      store.markRead(m.id);
      expect(store.find(m.id)!.unread).toBe(false);
    });

    it("is idempotent", () => {
      const m = store.create({ to: "cc", from: "cursor", subject: "Test", body: "x" });
      store.markRead(m.id);
      store.markRead(m.id);
      expect(store.find(m.id)!.unread).toBe(false);
    });
  });

  describe("markAllRead", () => {
    it("marks multiple messages as read in one lock acquisition", () => {
      const m1 = store.create({ to: "cc", from: "cursor", subject: "A", body: "x" });
      const m2 = store.create({ to: "cc", from: "cursor", subject: "B", body: "y" });
      store.markAllRead([m1.id, m2.id]);
      expect(store.find(m1.id)!.unread).toBe(false);
      expect(store.find(m2.id)!.unread).toBe(false);
    });
  });

  describe("find", () => {
    it("returns metadata for existing message", () => {
      const m = store.create({ to: "cc", from: "cursor", subject: "Find me", body: "x" });
      const found = store.find(m.id);
      expect(found).toBeDefined();
      expect(found!.subject).toBe("Find me");
    });

    it("returns undefined for nonexistent ID", () => {
      expect(store.find("msg-00000000")).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/message-store.test.ts`
Expected: FAIL — `store.inbox is not a function`, `store.markRead is not a function`, `store.find is not a function`

- [ ] **Step 3: Implement inbox, find, markRead, markAllRead**

Add these methods to `MessageStore` class in `src/message-store.ts`:

```typescript
  find(id: string): MessageMeta | undefined {
    return this.readIndex().find((m) => m.id === id);
  }

  inbox(
    agentId: string,
    baseId: string,
    opts?: { channel?: string; includeRead?: boolean },
  ): Message[] {
    const index = this.readIndex();
    const targets = new Set([agentId, baseId]);

    const filtered = index.filter((m) => {
      if (!targets.has(m.to)) return false;
      if (!opts?.includeRead && !m.unread) return false;
      if (opts?.channel && m.channel !== opts.channel) return false;
      return true;
    });

    return filtered.map((meta) => ({
      ...meta,
      body: this.readBody(meta.id),
    }));
  }

  markRead(id: string): void {
    this.acquireLock();
    try {
      const index = this.readIndex();
      const entry = index.find((m) => m.id === id);
      if (entry) entry.unread = false;
      this.writeIndex(index);
    } finally {
      this.releaseLock();
    }
  }

  markAllRead(ids: string[]): void {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    this.acquireLock();
    try {
      const index = this.readIndex();
      for (const entry of index) {
        if (idSet.has(entry.id)) entry.unread = false;
      }
      this.writeIndex(index);
    } finally {
      this.releaseLock();
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/message-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/message-store.ts tests/message-store.test.ts
git commit -m "feat: MessageStore create, inbox, find, markRead, markAllRead"
```

---

### Task 3: MessageStore — threading and conversations

**Files:**
- Modify: `src/message-store.ts` (add `thread`, `conversations`, `query`)
- Modify: `tests/message-store.test.ts`

- [ ] **Step 1: Write tests for thread, conversations, and query**

Add to `tests/message-store.test.ts`:

```typescript
  describe("thread", () => {
    it("returns all messages in a thread sorted by timestamp", () => {
      const root = store.create({
        to: "cc", from: "cursor", subject: "Root", body: "start",
      });
      const reply1 = store.create({
        to: "cursor", from: "cc", subject: "Re: Root", body: "reply 1",
        reply_to: root.id, thread_id: root.thread_id,
      });
      const reply2 = store.create({
        to: "cc", from: "cursor", subject: "Re: Root", body: "reply 2",
        reply_to: reply1.id, thread_id: root.thread_id,
      });
      // Unrelated message
      store.create({ to: "cc", from: "other", subject: "Noise", body: "x" });

      const thread = store.thread(root.id);
      expect(thread).toHaveLength(3);
      expect(thread[0]!.id).toBe(root.id);
      expect(thread[1]!.id).toBe(reply1.id);
      expect(thread[2]!.id).toBe(reply2.id);
    });

    it("finds thread from any message in it", () => {
      const root = store.create({
        to: "cc", from: "cursor", subject: "Thread test", body: "root",
      });
      const reply = store.create({
        to: "cursor", from: "cc", subject: "Re: Thread test", body: "reply",
        reply_to: root.id, thread_id: root.thread_id,
      });

      const fromRoot = store.thread(root.id);
      const fromReply = store.thread(reply.id);
      expect(fromRoot.map((m) => m.id)).toEqual(fromReply.map((m) => m.id));
    });

    it("returns empty array for nonexistent message", () => {
      expect(store.thread("msg-00000000")).toEqual([]);
    });
  });

  describe("conversations", () => {
    it("groups messages by thread and returns summaries", () => {
      const t1Root = store.create({
        to: "cc", from: "cursor", subject: "Thread 1", body: "a",
      });
      store.create({
        to: "cursor", from: "cc", subject: "Re: Thread 1", body: "b",
        reply_to: t1Root.id, thread_id: t1Root.thread_id,
      });
      store.create({
        to: "cc", from: "cursor", subject: "Thread 2", body: "c",
      });

      const convos = store.conversations("cc", "cc");
      expect(convos.length).toBeGreaterThanOrEqual(2);

      const t1 = convos.find((c) => c.thread_id === t1Root.thread_id);
      expect(t1).toBeDefined();
      expect(t1!.message_count).toBe(2);
      expect(t1!.subject).toBe("Thread 1");
    });

    it("computes unread counts correctly", () => {
      const root = store.create({
        to: "cc", from: "cursor", subject: "Unread test", body: "a",
      });
      store.create({
        to: "cc", from: "cursor", subject: "Re: Unread test", body: "b",
        reply_to: root.id, thread_id: root.thread_id,
      });
      store.markRead(root.id);

      const convos = store.conversations("cc", "cc");
      const convo = convos.find((c) => c.thread_id === root.thread_id);
      expect(convo!.unread_count).toBe(1);
    });
  });

  describe("query", () => {
    it("filters by from", () => {
      store.create({ to: "cc", from: "cursor", subject: "From cursor", body: "a" });
      store.create({ to: "cc", from: "other", subject: "From other", body: "b" });

      const results = store.query({ from: "cursor" });
      expect(results.every((m) => m.from === "cursor")).toBe(true);
    });

    it("filters by to", () => {
      store.create({ to: "cc", from: "cursor", subject: "To CC", body: "a" });
      store.create({ to: "other", from: "cursor", subject: "To other", body: "b" });

      const results = store.query({ to: "cc" });
      expect(results.every((m) => m.to === "cc")).toBe(true);
    });

    it("respects limit", () => {
      for (let i = 0; i < 10; i++) {
        store.create({ to: "cc", from: "cursor", subject: `Msg ${i}`, body: "x" });
      }
      const results = store.query({ limit: 3 });
      expect(results).toHaveLength(3);
    });

    it("sorts by timestamp descending by default", () => {
      store.create({ to: "cc", from: "cursor", subject: "First", body: "a" });
      store.create({ to: "cc", from: "cursor", subject: "Second", body: "b" });

      const results = store.query({});
      expect(results[0]!.subject).toBe("Second");
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/message-store.test.ts`
Expected: FAIL — `store.thread is not a function`, `store.conversations is not a function`, `store.query is not a function`

- [ ] **Step 3: Implement thread, conversations, and query**

Add to `MessageStore` class in `src/message-store.ts`:

```typescript
  thread(messageId: string): Message[] {
    const index = this.readIndex();
    const target = index.find((m) => m.id === messageId);
    if (!target) return [];

    const threadId = target.thread_id;
    const threadMetas = index
      .filter((m) => m.thread_id === threadId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return threadMetas.map((meta) => ({
      ...meta,
      body: this.readBody(meta.id),
    }));
  }

  conversations(
    agentId: string,
    baseId: string,
    opts?: { status?: "open" | "closed" | "all" },
  ): ConversationSummary[] {
    const index = this.readIndex();
    const targets = new Set([agentId, baseId]);

    // Find all messages involving this agent (sent to or from)
    const relevant = index.filter(
      (m) => targets.has(m.to) || targets.has(m.from),
    );

    const threads = new Map<string, MessageMeta[]>();
    for (const m of relevant) {
      const existing = threads.get(m.thread_id) ?? [];
      existing.push(m);
      threads.set(m.thread_id, existing);
    }

    const summaries: ConversationSummary[] = [];
    for (const [threadId, msgs] of threads) {
      msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const root = msgs[0]!;
      const last = msgs[msgs.length - 1]!;
      const unreadCount = msgs.filter((m) => m.unread && targets.has(m.to)).length;

      summaries.push({
        thread_id: threadId,
        subject: root.subject.replace(/^Re: /, ""),
        last_message: last,
        unread_count: unreadCount,
        message_count: msgs.length,
      });
    }

    summaries.sort(
      (a, b) =>
        new Date(b.last_message.timestamp).getTime() -
        new Date(a.last_message.timestamp).getTime(),
    );
    return summaries;
  }

  query(filter: {
    from?: string;
    to?: string;
    channel?: string;
    limit?: number;
  }): MessageMeta[] {
    let results = this.readIndex();

    if (filter.from) results = results.filter((m) => m.from === filter.from);
    if (filter.to) results = results.filter((m) => m.to === filter.to);
    if (filter.channel) results = results.filter((m) => m.channel === filter.channel);

    // Default sort: newest first
    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (filter.limit) results = results.slice(0, filter.limit);

    return results;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/message-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/message-store.ts tests/message-store.test.ts
git commit -m "feat: MessageStore thread, conversations, and query methods"
```

---

### Task 4: MessageStore — prune and edge cases

**Files:**
- Modify: `src/message-store.ts` (add `prune`)
- Modify: `tests/message-store.test.ts`

- [ ] **Step 1: Write tests for prune and edge cases**

Add to `tests/message-store.test.ts`:

```typescript
  describe("prune", () => {
    it("removes read messages older than threshold", () => {
      const m = store.create({ to: "cc", from: "cursor", subject: "Old", body: "x" });
      store.markRead(m.id);

      // Manually backdate the entry
      const index = JSON.parse(readFileSync(join(tmpDir, "index.json"), "utf-8"));
      index[0].timestamp = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      writeFileSync(join(tmpDir, "index.json"), JSON.stringify(index), "utf-8");

      const pruned = store.prune({ olderThanDays: 7, readOnly: true });
      expect(pruned).toBe(1);
      expect(store.find(m.id)).toBeUndefined();
    });

    it("does not prune unread messages", () => {
      store.create({ to: "cc", from: "cursor", subject: "Unread old", body: "x" });

      const index = JSON.parse(readFileSync(join(tmpDir, "index.json"), "utf-8"));
      index[0].timestamp = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      writeFileSync(join(tmpDir, "index.json"), JSON.stringify(index), "utf-8");

      const pruned = store.prune({ olderThanDays: 7, readOnly: true });
      expect(pruned).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("inbox returns empty array when no messages", () => {
      expect(store.inbox("cc", "cc")).toEqual([]);
    });

    it("handles concurrent create from same process", () => {
      const results: MessageMeta[] = [];
      for (let i = 0; i < 20; i++) {
        results.push(
          store.create({ to: "cc", from: "cursor", subject: `Msg ${i}`, body: `body ${i}` }),
        );
      }
      expect(new Set(results.map((r) => r.id)).size).toBe(20);

      const index = store.readIndex();
      expect(index.length).toBe(20);
    });

    it("markRead with nonexistent ID is a no-op", () => {
      expect(() => store.markRead("msg-00000000")).not.toThrow();
    });
  });
```

Note: for the prune test, we need to import `readFileSync` and `writeFileSync` at the top of the test file. Update the import:
```typescript
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
```

Also, `readIndex` needs to be public for the concurrent-create test. Change it from `private` to `public` in `message-store.ts`, or use `find` to verify the count instead. Better approach — change the test:

```typescript
    it("handles concurrent create from same process", () => {
      const results: MessageMeta[] = [];
      for (let i = 0; i < 20; i++) {
        results.push(
          store.create({ to: "cc", from: "cursor", subject: `Msg ${i}`, body: `body ${i}` }),
        );
      }
      expect(new Set(results.map((r) => r.id)).size).toBe(20);
      // Verify all are findable
      for (const r of results) {
        expect(store.find(r.id)).toBeDefined();
      }
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/message-store.test.ts`
Expected: FAIL — `store.prune is not a function`

- [ ] **Step 3: Implement prune**

Add to `MessageStore` class in `src/message-store.ts`:

```typescript
  prune(opts?: { olderThanDays?: number; readOnly?: boolean }): number {
    const days = opts?.olderThanDays ?? 7;
    const readOnly = opts?.readOnly ?? true;
    const threshold = Date.now() - days * 24 * 60 * 60 * 1000;

    this.acquireLock();
    try {
      const index = this.readIndex();
      const keep: MessageMeta[] = [];
      let pruned = 0;

      for (const entry of index) {
        const age = new Date(entry.timestamp).getTime();
        const shouldPrune = age < threshold && (!readOnly || !entry.unread);
        if (shouldPrune) {
          try {
            const { unlinkSync } = require("node:fs") as typeof import("node:fs");
            unlinkSync(this.bodyPath(entry.id));
          } catch { /* body may already be gone */ }
          pruned++;
        } else {
          keep.push(entry);
        }
      }

      this.writeIndex(keep);
      return pruned;
    } finally {
      this.releaseLock();
    }
  }
```

Fix: use top-level import for `unlinkSync` instead of inline require. Update the top import:
```typescript
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync,
  rmdirSync, statSync, unlinkSync,
} from "node:fs";
```

And simplify the prune body cleanup:
```typescript
          try { unlinkSync(this.bodyPath(entry.id)); } catch { /* body may already be gone */ }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/message-store.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to verify nothing is broken**

Run: `npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/message-store.ts tests/message-store.test.ts
git commit -m "feat: MessageStore prune and edge case handling"
```

---

## Chunk 2: Config + Startup + Wire Tool Handlers

### Task 5: Add messageDir to Config and initialize on startup

**Files:**
- Modify: `src/config.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add messageDir to Config interface**

In `src/config.ts`, add `messageDir` to the `Config` interface after `projectRoot`:

```typescript
export interface Config {
  baseId: string;
  agentId: string;
  agentName: string;
  beadsDir?: string;
  channel?: string;
  projectRoot?: string;
  messageDir?: string;
  env: AgentEnv;
}
```

At the end of `parseConfig()`, before the return, compute `messageDir`:

```typescript
  const messageDir = projectRoot ? join(projectRoot, ".am") : undefined;

  return { baseId, agentId, agentName, beadsDir, channel, projectRoot, messageDir, env };
```

Add `join` to the existing import from `"node:path"` (already imported — verify it includes `join`). The existing import is:
```typescript
import { resolve, dirname, join } from "node:path";
```
Already has `join` — no change needed.

- [ ] **Step 2: Initialize .am/ directories on MCP server startup**

In `src/index.ts`, add import for `MessageStore` and create instance.

After `const config = parseConfig();` (line 30), add:

```typescript
import { MessageStore } from "./message-store.js";

// ... (after parseConfig)

let messageStore: MessageStore | undefined;
if (config.messageDir) {
  messageStore = new MessageStore(config.messageDir);
}
```

Move the import to the top of the file with the other imports.

- [ ] **Step 3: Build and run existing tests**

Run: `npm run build && npx vitest run`
Expected: Build succeeds, all tests pass (no behavioral change yet)

- [ ] **Step 4: Commit**

```bash
git add src/config.ts src/index.ts
git commit -m "feat: add messageDir to Config, initialize MessageStore on startup"
```

---

### Task 6: Wire send_message to MessageStore

**Files:**
- Modify: `src/tools/send-message.ts`
- Modify: `src/index.ts` (pass `messageStore` to handler)

- [ ] **Step 1: Refactor send-message.ts to use MessageStore**

Replace the contents of `src/tools/send-message.ts` with:

```typescript
import { z } from "zod";
import type { Config } from "../config.js";
import type { MessageStore } from "../message-store.js";
import { listAgents } from "../beads.js";

export const sendMessageSchema = {
  to: z.string().describe("Target agent ID — use base ID to reach any instance (e.g. 'claude-code', 'codex'), or a specific session ID (e.g. 'cc-design') to target one instance"),
  subject: z.string().describe("Short summary of the message"),
  body: z.string().describe("Full message content"),
  context_files: z.array(z.string()).optional().describe("Paths to files the recipient should read"),
  action: z.string().optional().describe("What the recipient should do: review, brainstorm, implement, reply"),
  priority: z.enum(["normal", "urgent"]).optional().describe("Message priority (default: normal)"),
  worktree: z.string().optional().describe("Suggest the recipient use a git worktree with this name for isolation (e.g. 'add-tests'). The recipient's agent will present this as an option to the user, not execute automatically."),
  task_id: z.string().optional().describe("Link this message to a Beads task ID (e.g. 'agent-messenger-z1b.1'). Adds a refs:<id> label for cross-referencing."),
};

function getKnownAgents(config: Config): Set<string> {
  const known = new Set<string>();
  try {
    for (const agent of listAgents(config)) {
      known.add(agent.agent_id);
      known.add(agent.base_id);
    }
  } catch { /* no agents discoverable */ }
  return known;
}

function buildWorktreeSuggestion(name: string): string {
  return [
    "",
    "---",
    `**Worktree suggestion:** The sending agent suggested using a worktree named \`${name}\`.`,
    "Before proceeding, ask the user how they'd like to handle workspace isolation:",
    `1. Use a worktree: \`claude --worktree ${name}\``,
    "2. Stay on the current branch",
    "3. Create a regular feature branch",
  ].join("\n");
}

export function handleSendMessage(config: Config, store?: MessageStore) {
  return (args: {
    to: string;
    subject: string;
    body: string;
    context_files?: string[];
    action?: string;
    priority?: "normal" | "urgent";
    worktree?: string;
    task_id?: string;
  }) => {
    if (!store) {
      throw new Error("Message store not initialized — is .am/ directory accessible?");
    }

    let body = args.body;
    if (args.worktree) {
      body += buildWorktreeSuggestion(args.worktree);
    }

    const meta = store.create({
      to: args.to,
      from: config.agentId,
      subject: args.subject,
      body,
      context_files: args.context_files,
      action: args.action,
      priority: args.priority,
      task_id: args.task_id,
      channel: config.channel,
    });

    let warning: string | undefined;
    const known = getKnownAgents(config);
    if (known.size > 0 && !known.has(args.to)) {
      const suggestions = [...known].filter(a => a !== config.agentId);
      warning = suggestions.length > 0
        ? `No agent named '${args.to}' is currently online. Online agents: ${suggestions.join(", ")}. Message sent anyway — it will be delivered when an agent with that ID checks their inbox.`
        : `No agent named '${args.to}' is currently online. Message sent anyway — it will be delivered when an agent with that ID checks their inbox.`;
    }

    const response: Record<string, unknown> = { message_id: meta.id, status: "sent" };
    if (args.worktree) response["worktree_suggested"] = args.worktree;
    if (args.task_id) response["linked_task"] = args.task_id;
    if (warning) response["warning"] = warning;

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  };
}
```

Key changes: `handleSendMessage` now takes `(config, store?)`. Uses `store.create()` instead of `createMessage()`. No longer imports `createMessage` from beads.

- [ ] **Step 2: Update src/index.ts tool registration for send_message**

Change the `send_message` registration (around line 40) from:

```typescript
server.tool(
  "send_message",
  "Send a message to another agent",
  sendMessageSchema,
  handleSendMessage(config)
);
```

To:

```typescript
server.tool(
  "send_message",
  "Send a message to another agent",
  sendMessageSchema,
  handleSendMessage(config, messageStore)
);
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/tools/send-message.ts src/index.ts
git commit -m "feat: wire send_message to file-based MessageStore"
```

---

### Task 7: Wire check_inbox to MessageStore

**Files:**
- Modify: `src/tools/check-inbox.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Refactor check-inbox.ts**

Replace `src/tools/check-inbox.ts`:

```typescript
import { z } from "zod";
import type { Config } from "../config.js";
import type { MessageStore } from "../message-store.js";

export const checkInboxSchema = {
  include_read: z.boolean().optional().describe("Include already-read messages (default: false)"),
  auto_mark_read: z.boolean().optional().describe("Automatically mark fetched messages as read (default: true)"),
};

export function handleCheckInbox(config: Config, store?: MessageStore) {
  return (args: { include_read?: boolean; auto_mark_read?: boolean }) => {
    if (!store) {
      throw new Error("Message store not initialized — is .am/ directory accessible?");
    }

    const autoMark = args.auto_mark_read !== false;
    const messages = store.inbox(config.agentId, config.baseId, {
      channel: config.channel,
      includeRead: args.include_read,
    });

    const formatted = messages.map((m) => ({
      id: m.id,
      from: m.from,
      subject: m.subject,
      body: m.body,
      context_files: m.context_files.length > 0 ? m.context_files : extractContextFiles(m.body),
      action: m.action,
      priority: m.priority,
      timestamp: m.timestamp,
    }));

    if (autoMark) {
      const unreadIds = messages.filter((m) => m.unread).map((m) => m.id);
      if (unreadIds.length > 0) {
        store.markAllRead(unreadIds);
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            messages: formatted,
            auto_marked_read: autoMark ? formatted.length : 0,
          }, null, 2),
        },
      ],
    };
  };
}

function extractContextFiles(body: string): string[] {
  const match = body.match(/Context files:\n((?:- .+\n?)+)/);
  if (!match?.[1]) return [];
  return match[1]
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());
}
```

- [ ] **Step 2: Update src/index.ts for check_inbox**

Change:
```typescript
  handleCheckInbox(config)
```
To:
```typescript
  handleCheckInbox(config, messageStore)
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/tools/check-inbox.ts src/index.ts
git commit -m "feat: wire check_inbox to file-based MessageStore"
```

---

### Task 8: Wire reply, mark-read, get-thread, list-conversations

**Files:**
- Modify: `src/tools/reply.ts`
- Modify: `src/tools/mark-read.ts`
- Modify: `src/tools/get-thread.ts`
- Modify: `src/tools/list-conversations.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Refactor reply.ts**

Replace `src/tools/reply.ts`:

```typescript
import { z } from "zod";
import type { Config } from "../config.js";
import type { MessageStore } from "../message-store.js";

export const replySchema = {
  message_id: z.string().describe("The message ID being replied to"),
  body: z.string().describe("Reply content"),
  context_files: z.array(z.string()).optional().describe("Paths to files the recipient should read"),
  task_id: z.string().optional().describe("Link this reply to a Beads task ID (e.g. 'agent-messenger-z1b.1'). Adds a refs:<id> label and appends a summary to the task's notes."),
};

export function handleReply(config: Config, store?: MessageStore) {
  return (args: { message_id: string; body: string; context_files?: string[]; task_id?: string }) => {
    if (!store) {
      throw new Error("Message store not initialized — is .am/ directory accessible?");
    }

    const original = store.find(args.message_id);
    if (!original) {
      throw new Error(`Message ${args.message_id} not found`);
    }

    const originalFrom = original.from;
    const subject = original.subject.startsWith("Re: ") ? original.subject : `Re: ${original.subject}`;

    let body = args.body;
    if (args.context_files?.length) {
      body += "\n\n---\nContext files:\n" + args.context_files.map((f) => `- ${f}`).join("\n");
    }

    const meta = store.create({
      to: originalFrom,
      from: config.agentId,
      subject,
      body,
      channel: original.channel,
      context_files: args.context_files,
      task_id: args.task_id,
      reply_to: args.message_id,
      thread_id: original.thread_id,
    });

    if (args.task_id) {
      try {
        const { bdExecPublic } = await_beads_update(config, args.task_id, meta, originalFrom);
      } catch { /* best-effort */ }
    }

    const response: Record<string, unknown> = { message_id: meta.id, status: "sent" };
    if (args.task_id) response["linked_task"] = args.task_id;

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  };
}
```

Wait — the task_id linking needs access to `bdExec` from beads.ts to append notes to the Beads task. That's a cross-store operation. The simplest approach: import `bdExec` as a standalone helper or keep a thin wrapper. Since `bdExec` is currently not exported, we need to either export it or add a dedicated helper.

Better approach: add a small exported `appendTaskNote` helper to `beads.ts` that reply.ts can call for the cross-store link, and skip the broken pseudo-code above.

In `src/beads.ts`, add near the end:

```typescript
export function appendTaskNote(config: Config, taskId: string, note: string): void {
  bdExec(config, ["update", taskId, "--append-notes", note]);
}
```

Then `reply.ts` becomes simpler. The task-link section:

```typescript
    if (args.task_id && config.beadsDir) {
      try {
        const { appendTaskNote } = await import("../beads.js");
        const summary = args.body.length > 200 ? args.body.slice(0, 197) + "..." : args.body;
        const note = `[${config.agentId} → ${originalFrom}] ${subject}: ${summary}`;
        appendTaskNote(config, args.task_id, note);
      } catch { /* best-effort — don't fail the reply if task update fails */ }
    }
```

Actually, dynamic import makes this messy. Better: import statically at top and just catch errors.

Final `src/tools/reply.ts`:

```typescript
import { z } from "zod";
import type { Config } from "../config.js";
import type { MessageStore } from "../message-store.js";
import { appendTaskNote } from "../beads.js";

export const replySchema = {
  message_id: z.string().describe("The message ID being replied to"),
  body: z.string().describe("Reply content"),
  context_files: z.array(z.string()).optional().describe("Paths to files the recipient should read"),
  task_id: z.string().optional().describe("Link this reply to a Beads task ID (e.g. 'agent-messenger-z1b.1'). Adds a refs:<id> label and appends a summary to the task's notes."),
};

export function handleReply(config: Config, store?: MessageStore) {
  return (args: { message_id: string; body: string; context_files?: string[]; task_id?: string }) => {
    if (!store) {
      throw new Error("Message store not initialized — is .am/ directory accessible?");
    }

    const original = store.find(args.message_id);
    if (!original) {
      throw new Error(`Message ${args.message_id} not found`);
    }

    const originalFrom = original.from;
    const subject = original.subject.startsWith("Re: ") ? original.subject : `Re: ${original.subject}`;

    let body = args.body;
    if (args.context_files?.length) {
      body += "\n\n---\nContext files:\n" + args.context_files.map((f) => `- ${f}`).join("\n");
    }

    const meta = store.create({
      to: originalFrom,
      from: config.agentId,
      subject,
      body,
      channel: original.channel,
      context_files: args.context_files,
      task_id: args.task_id,
      reply_to: args.message_id,
      thread_id: original.thread_id,
    });

    if (args.task_id && config.beadsDir) {
      try {
        const summary = args.body.length > 200 ? args.body.slice(0, 197) + "..." : args.body;
        const note = `[${config.agentId} → ${originalFrom}] ${subject}: ${summary}`;
        appendTaskNote(config, args.task_id, note);
      } catch { /* best-effort */ }
    }

    const response: Record<string, unknown> = { message_id: meta.id, status: "sent" };
    if (args.task_id) response["linked_task"] = args.task_id;

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  };
}
```

- [ ] **Step 2: Add appendTaskNote export to beads.ts**

In `src/beads.ts`, add after the `listLinkedMessages` function:

```typescript
export function appendTaskNote(config: Config, taskId: string, note: string): void {
  bdExec(config, ["update", taskId, "--append-notes", note]);
}
```

- [ ] **Step 3: Refactor mark-read.ts**

Replace `src/tools/mark-read.ts`:

```typescript
import { z } from "zod";
import type { Config } from "../config.js";
import type { MessageStore } from "../message-store.js";

export const markReadSchema = {
  message_id: z.string().describe("The message ID to mark as read"),
};

export function handleMarkRead(_config: Config, store?: MessageStore) {
  return (args: { message_id: string }) => {
    if (!store) {
      throw new Error("Message store not initialized — is .am/ directory accessible?");
    }

    store.markRead(args.message_id);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "ok" }, null, 2),
        },
      ],
    };
  };
}
```

- [ ] **Step 4: Refactor get-thread.ts**

Replace `src/tools/get-thread.ts`:

```typescript
import { z } from "zod";
import type { Config } from "../config.js";
import type { MessageStore } from "../message-store.js";

export const getThreadSchema = {
  message_id: z.string().describe("Any message ID in the thread"),
};

export function handleGetThread(_config: Config, store?: MessageStore) {
  return (args: { message_id: string }) => {
    if (!store) {
      throw new Error("Message store not initialized — is .am/ directory accessible?");
    }

    const messages = store.thread(args.message_id);
    const formatted = messages.map((m) => ({
      id: m.id,
      from: m.from,
      subject: m.subject,
      body: m.body,
      timestamp: m.timestamp,
    }));
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ messages: formatted }, null, 2),
        },
      ],
    };
  };
}
```

- [ ] **Step 5: Refactor list-conversations.ts**

Replace `src/tools/list-conversations.ts`:

```typescript
import { z } from "zod";
import type { Config } from "../config.js";
import type { MessageStore } from "../message-store.js";

export const listConversationsSchema = {
  status: z.enum(["open", "closed", "all"]).optional().describe("Filter by status (default: all)"),
};

export function handleListConversations(config: Config, store?: MessageStore) {
  return (args: { status?: "open" | "closed" | "all" }) => {
    if (!store) {
      throw new Error("Message store not initialized — is .am/ directory accessible?");
    }

    const conversations = store.conversations(config.agentId, config.baseId, {
      status: args.status,
    });
    const formatted = conversations.map((c) => ({
      thread_id: c.thread_id,
      subject: c.subject,
      last_message: {
        id: c.last_message.id,
        from: c.last_message.from,
        timestamp: c.last_message.timestamp,
      },
      unread_count: c.unread_count,
      message_count: c.message_count,
    }));
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ conversations: formatted }, null, 2),
        },
      ],
    };
  };
}
```

- [ ] **Step 6: Update all tool registrations in src/index.ts**

For each of the four tools, pass `messageStore` as the second argument:

```typescript
server.tool("reply", ..., handleReply(config, messageStore));
server.tool("get_thread", ..., handleGetThread(config, messageStore));
server.tool("list_conversations", ..., handleListConversations(config, messageStore));
server.tool("mark_read", ..., handleMarkRead(config, messageStore));
```

The `_config` parameter in `mark-read` and `get-thread` handlers uses an underscore prefix since config isn't needed (store handles everything). However, the McpServer tool handler signature expects the same pattern. The underscore is fine — TypeScript allows it.

- [ ] **Step 7: Build and verify**

Run: `npm run build`
Expected: No errors

- [ ] **Step 8: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (unit + message-store tests)

- [ ] **Step 9: Commit**

```bash
git add src/tools/reply.ts src/tools/mark-read.ts src/tools/get-thread.ts src/tools/list-conversations.ts src/index.ts src/beads.ts
git commit -m "feat: wire reply, mark-read, get-thread, list-conversations to MessageStore"
```

---

## Chunk 3: query-beads Routing, CLI Updates, Cleanup

### Task 9: Route query_beads type=message to MessageStore

**Files:**
- Modify: `src/tools/query-beads.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Update query-beads.ts to route messages**

In `src/tools/query-beads.ts`, change the handler to accept a `MessageStore` parameter and route `type: "message"` queries to it.

Replace `src/tools/query-beads.ts`:

```typescript
import { z } from "zod";
import type { Config } from "../config.js";
import type { MessageStore } from "../message-store.js";
import { queryBeads } from "../beads.js";

export const queryBeadsSchema = {
  type: z.enum(["message", "task", "bug", "feature", "epic", "chore"]).describe("Beads record type to query"),
  from: z.string().optional().describe("Filter by sender agent ID (convenience — adds from:<id> label)"),
  to: z.string().optional().describe("Filter by recipient agent ID (convenience — adds to:<id> label)"),
  channel: z.string().optional().describe("Filter by channel (convenience — adds channel:<name> label)"),
  labels: z.array(z.string()).optional().describe("Raw label filters (AND logic). Use for advanced queries, e.g. ['kind:presence', 'agent:cc-debug']"),
  status: z.enum(["open", "closed", "all"]).optional().describe("Filter by status (default: open)"),
  limit: z.number().optional().describe("Max results to return (default: 20)"),
  sort: z.enum(["created", "updated", "priority"]).optional().describe("Sort field (default: created)"),
  reverse: z.boolean().optional().describe("Reverse sort order — newest first (default: true)"),
};

export function handleQueryBeads(config: Config, store?: MessageStore) {
  return (args: {
    type: string;
    from?: string;
    to?: string;
    channel?: string;
    labels?: string[];
    status?: string;
    limit?: number;
    sort?: string;
    reverse?: boolean;
  }) => {
    if (args.type === "message" && store) {
      return handleMessageQuery(store, args);
    }
    return handleBeadsQuery(config, args);
  };
}

function handleMessageQuery(store: MessageStore, args: {
  from?: string;
  to?: string;
  channel?: string;
  limit?: number;
  reverse?: boolean;
}) {
  const results = store.query({
    from: args.from,
    to: args.to,
    channel: args.channel,
    limit: args.limit ?? 20,
  });

  const formatted = results.map((r) => ({
    id: r.id,
    title: r.subject,
    type: "message",
    status: r.unread ? "unread" : "read",
    priority: r.priority === "urgent" ? 0 : 2,
    from: r.from,
    to: r.to,
    channel: r.channel,
    labels: [
      r.action ? `action:${r.action}` : null,
      r.task_id ? `refs:${r.task_id}` : null,
    ].filter(Boolean),
    body: undefined,
    created_at: r.timestamp,
    updated_at: r.timestamp,
  }));

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ count: formatted.length, results: formatted }, null, 2),
      },
    ],
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

function handleBeadsQuery(config: Config, args: {
  type: string;
  from?: string;
  to?: string;
  channel?: string;
  labels?: string[];
  status?: string;
  limit?: number;
  sort?: string;
  reverse?: boolean;
}) {
  const labels: string[] = [...(args.labels ?? [])];
  if (args.from) labels.push(`from:${args.from}`);
  if (args.to) labels.push(`to:${args.to}`);
  if (args.channel) labels.push(`channel:${args.channel}`);

  const results = queryBeads(config, {
    type: args.type,
    labels: labels.length > 0 ? labels : undefined,
    status: args.status ?? "open",
    limit: args.limit ?? 20,
    sort: args.sort ?? "created",
    reverse: args.reverse !== false,
  });

  const formatted = results.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.issue_type,
    status: r.status,
    priority: r.priority,
    from: r.labels?.find((l) => l.startsWith("from:"))?.slice(5),
    to: r.labels?.find((l) => l.startsWith("to:"))?.slice(3),
    channel: r.labels?.find((l) => l.startsWith("channel:"))?.slice(8),
    labels: r.labels?.filter((l) =>
      !l.startsWith("from:") && !l.startsWith("to:") && !l.startsWith("channel:")
    ),
    body: r.description ? truncate(r.description, 500) : undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ count: formatted.length, results: formatted }, null, 2),
      },
    ],
  };
}
```

- [ ] **Step 2: Update src/index.ts for query_beads**

```typescript
server.tool("query_beads", ..., handleQueryBeads(config, messageStore));
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/tools/query-beads.ts src/index.ts
git commit -m "feat: route query_beads type=message to file-based MessageStore"
```

---

### Task 10: Update CLI commands (status, log, init)

**Files:**
- Modify: `src/cli/status.ts`
- Modify: `src/cli/log.ts`
- Modify: `src/cli/init.ts`

- [ ] **Step 1: Update status.ts to read from .am/**

In `src/cli/status.ts`, replace the `bdList` function and the message-loading section in `status()`.

Add near the top (after imports):

```typescript
import { MessageStore } from "../message-store.js";
```

Replace the `bdList` function call and `messages` loading in `status()` (around line 129) with:

```typescript
  const amDir = join(projectRoot, ".am");
  let messages: StatusMessage[];

  if (existsSync(amDir)) {
    const store = new MessageStore(amDir);
    const index = store.query({});
    messages = index.map((m) => ({
      id: m.id,
      title: m.subject,
      description: undefined,
      status: m.unread ? "open" : "closed",
      priority: m.priority === "urgent" ? 0 : 2,
      issue_type: "message",
      created_at: m.timestamp,
      updated_at: m.timestamp,
      labels: [
        `to:${m.to}`,
        `from:${m.from}`,
        ...(m.unread ? ["unread"] : []),
        ...(m.channel ? [`channel:${m.channel}`] : []),
        ...(m.action ? [`action:${m.action}`] : []),
      ],
    }));
  } else {
    messages = bdList(beadsDir);
  }
```

This falls back to Beads if `.am/` doesn't exist yet (backward compat).

- [ ] **Step 2: Update log.ts to read from .am/**

Similar pattern in `src/cli/log.ts`. Add import for `MessageStore`, and in the main `log()` function, check for `.am/` and read from it preferentially.

Replace the messages-loading section (around line 238) with:

```typescript
  const amDir = join(projectRoot, ".am");

  if (existsSync(amDir) && !opts.thread) {
    const store = new MessageStore(amDir);
    const results = store.query({
      from: opts.agent,
      channel: opts.channel,
      limit: opts.limit,
    });

    if (results.length === 0) {
      console.log("\nNo messages found.\n");
      return;
    }

    const filters: string[] = [];
    if (opts.agent) filters.push(`agent: ${opts.agent}`);
    if (opts.channel) filters.push(`channel: ${opts.channel}`);
    const filterStr = filters.length > 0 ? ` (${filters.join(", ")})` : "";
    console.log(`\nagent-messenger log${filterStr} — ${results.length} messages`);
    console.log("=".repeat(60));

    for (const meta of results) {
      const time = formatTimestamp(meta.timestamp);
      const unread = meta.unread ? " *" : "";
      const chTag = meta.channel ? ` #${meta.channel}` : "";
      const refTag = meta.task_id ? ` [task:${meta.task_id}]` : "";
      const priority = meta.priority === "urgent" ? " [URGENT]" : "";

      console.log(`${meta.from} -> ${meta.to}  ${time}${unread}${priority}${chTag}${refTag}`);
      console.log(`  ${meta.subject}  (${meta.id})`);
      console.log();
    }
    return;
  }
```

Keep the existing Beads-based code as the fallback for when `.am/` doesn't exist or for thread view (thread reconstruction from Beads still works for old messages).

Add the `MessageStore` import and `existsSync` check at top of file (existsSync is already imported).

```typescript
import { MessageStore } from "../message-store.js";
```

- [ ] **Step 3: Update init.ts to create .am/ directory**

In `src/cli/init.ts`, find where the init command creates the `.beads/` directory or finishes setup. Add after the beads init:

```typescript
// Create .am/ message store directory
const amDir = join(projectRoot, ".am", "messages");
mkdirSync(amDir, { recursive: true });
writeFileSync(join(projectRoot, ".am", "index.json"), "[]", { flag: "wx" }); // wx = create only if doesn't exist
```

Also add `.am/` to the `.gitignore` if we're creating/updating it during init:

```typescript
// Add .am/ to .gitignore
const gitignorePath = join(projectRoot, ".gitignore");
if (existsSync(gitignorePath)) {
  const content = readFileSync(gitignorePath, "utf-8");
  if (!content.includes(".am/")) {
    appendFileSync(gitignorePath, "\n# Agent messenger store\n.am/\n");
  }
}
```

Need to import `appendFileSync` if not already imported.

- [ ] **Step 4: Build and run full test suite**

Run: `npm run build && npx vitest run`
Expected: Build succeeds, all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/cli/status.ts src/cli/log.ts src/cli/init.ts
git commit -m "feat: update CLI commands to read from .am/ message store"
```

---

### Task 11: Clean up beads.ts — remove dead message functions

**Files:**
- Modify: `src/beads.ts`

- [ ] **Step 1: Remove message-only functions from beads.ts**

Remove these functions from `src/beads.ts` (they are no longer called by any tool handler):
- `createMessage`
- `checkInbox`
- `replyToMessage`
- `showMessage`
- `markRead`
- `getThread`
- `findThreadRoot`
- `collectThread`
- `listConversations`
- `findRootId`
- The `Conversation` interface

Keep:
- `bdExec` (used internally by remaining functions)
- `bdJson` (used internally)
- `channelLabel` (used internally)
- `queryBeads` (still used for non-message queries)
- `appendTaskNote` (newly added, used by reply)
- All presence functions (`cleanStalePresence`, `registerPresence`, `deregisterPresence`, `listAgents`, etc.)
- All workflow checkpoint functions
- `listLinkedMessages` (uses beads for task-message cross-reference — still useful)
- `BeadsMessage`, `BeadsDep`, `AgentPresence`, `WorkflowCheckpoint` interfaces

- [ ] **Step 2: Verify no remaining imports of removed functions**

Run: `npm run build`
Expected: No errors. If there are "not exported" errors, find and remove the stale imports.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All pass. The integration test (`tests/integration.test.ts`) imports from `beads.js` — it tests the old Beads message path. Either update it to test via `MessageStore` or mark it as a legacy test. Best approach: add a parallel test using `MessageStore` and keep the Beads test as `skipIf(!canRun)` (it already is).

- [ ] **Step 4: Commit**

```bash
git add src/beads.ts
git commit -m "refactor: remove dead message functions from beads.ts"
```

---

### Task 12: Update integration test for MessageStore

**Files:**
- Modify: `tests/integration.test.ts`

- [ ] **Step 1: Add MessageStore integration test**

Add a new describe block at the end of `tests/integration.test.ts`:

```typescript
describe("integration: MessageStore full cycle", () => {
  let tmpDir: string;
  let store: MessageStore;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "am-msg-test-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("send → inbox → reply → thread → mark_read full cycle", async () => {
    const { MessageStore } = await import("../src/message-store.js");
    store = new MessageStore(tmpDir);

    // 1. Cursor sends a message to CC
    const sent = store.create({
      to: "claude-code", from: "cursor-opus",
      subject: "Test message", body: "Hello from cursor",
    });
    expect(sent.id).toMatch(/^msg-[0-9a-f]{8}$/);
    expect(sent.subject).toBe("Test message");

    // 2. CC checks inbox
    const inbox = store.inbox("claude-code", "claude-code");
    const found = inbox.find((m) => m.id === sent.id);
    expect(found).toBeDefined();
    expect(found!.from).toBe("cursor-opus");
    expect(found!.unread).toBe(true);

    // 3. CC replies
    const reply = store.create({
      to: "cursor-opus", from: "claude-code",
      subject: "Re: Test message", body: "Hello back from CC",
      reply_to: sent.id, thread_id: sent.thread_id,
    });
    expect(reply.thread_id).toBe(sent.thread_id);

    // 4. Get thread
    const thread = store.thread(reply.id);
    expect(thread).toHaveLength(2);
    expect(thread[0]!.id).toBe(sent.id);
    expect(thread[1]!.id).toBe(reply.id);

    // 5. Mark read
    store.markRead(sent.id);
    const inboxAfter = store.inbox("claude-code", "claude-code");
    expect(inboxAfter.find((m) => m.id === sent.id)).toBeUndefined();
  });

  it("channel isolation", async () => {
    const { MessageStore } = await import("../src/message-store.js");
    const chStore = new MessageStore(mkdtempSync(join(tmpdir(), "am-ch-test-")));

    chStore.create({
      to: "receiver", from: "agent-a", subject: "Ch1", body: "a", channel: "ch1",
    });
    chStore.create({
      to: "receiver", from: "agent-b", subject: "Ch2", body: "b", channel: "ch2",
    });

    const ch1 = chStore.inbox("receiver", "receiver", { channel: "ch1" });
    expect(ch1).toHaveLength(1);
    expect(ch1[0]!.subject).toBe("Ch1");

    const ch2 = chStore.inbox("receiver", "receiver", { channel: "ch2" });
    expect(ch2).toHaveLength(1);
    expect(ch2[0]!.subject).toBe("Ch2");
  });

  it("base ID routing", async () => {
    const { MessageStore } = await import("../src/message-store.js");
    const routeStore = new MessageStore(mkdtempSync(join(tmpdir(), "am-route-test-")));

    routeStore.create({
      to: "target", from: "sender", subject: "Base ID test", body: "x",
    });

    const inbox = routeStore.inbox("target-abcd", "target");
    expect(inbox.some((m) => m.subject === "Base ID test")).toBe(true);
  });
});
```

Add `MessageStore` import at the top of the file:
```typescript
import { MessageStore } from "../src/message-store.js";
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass — both old Beads integration tests (skipped if no bd) and new MessageStore tests.

- [ ] **Step 3: Commit**

```bash
git add tests/integration.test.ts
git commit -m "test: add MessageStore integration tests for full message cycle"
```

---

### Task 13: Final verification

- [ ] **Step 1: Clean build from scratch**

Run: `rm -rf dist && npm run build`
Expected: Clean build, no errors

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 3: Manual smoke test**

Run the MCP server directly and send a test initialize + tool call:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node dist/index.js --agent-id test --no-auto-id
```

Expected: Server responds with initialize result. No errors on stderr about `.am/` or MessageStore.

- [ ] **Step 4: Verify .am/ directory created**

Check that `<projectRoot>/.am/index.json` exists and contains `[]` or messages from tests.

- [ ] **Step 5: Commit any final fixes**

If any adjustments were needed, commit them:

```bash
git add -A
git commit -m "fix: final adjustments from smoke testing"
```
