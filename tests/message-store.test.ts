import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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
      expect(existsSync(join(tmpDir, "messages"))).toBe(true);
      expect(existsSync(join(tmpDir, "index.json"))).toBe(true);
    });

    it("index.json starts as empty array", () => {
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
      const body = 'backticks ` quotes " pipes | newlines\n\ttabs';
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
      const m1 = store.create({ to: "cc", from: "cursor", subject: "First", body: "a" });
      const m2 = store.create({ to: "cc", from: "cursor", subject: "Second", body: "b" });

      // Ensure distinct timestamps — CI runners can create both in <1ms
      const index = store.readIndex();
      const e1 = index.find((e) => e.id === m1.id)!;
      const e2 = index.find((e) => e.id === m2.id)!;
      e1.timestamp = "2026-01-01T00:00:00.000Z";
      e2.timestamp = "2026-01-01T00:00:01.000Z";
      (store as any).writeIndex(index);

      const results = store.query({});
      expect(results[0]!.subject).toBe("Second");
    });
  });

  describe("prune", () => {
    it("removes read messages older than threshold", () => {
      const m = store.create({ to: "cc", from: "cursor", subject: "Old", body: "x" });
      store.markRead(m.id);

      const index = JSON.parse(readFileSync(join(tmpDir, "index.json"), "utf-8"));
      index[0].timestamp = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      writeFileSync(join(tmpDir, "index.json"), JSON.stringify(index), "utf-8");

      const pruned = store.prune({ olderThanDays: 7, readOnly: true });
      expect(pruned).toBe(1);
      expect(store.find(m.id)).toBeUndefined();
    });

    it("does not prune unread messages when readOnly is true", () => {
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

    it("handles rapid sequential creates", () => {
      const results: ReturnType<typeof store.create>[] = [];
      for (let i = 0; i < 20; i++) {
        results.push(
          store.create({ to: "cc", from: "cursor", subject: `Msg ${i}`, body: `body ${i}` }),
        );
      }
      expect(new Set(results.map((r) => r.id)).size).toBe(20);
      for (const r of results) {
        expect(store.find(r.id)).toBeDefined();
      }
    });

    it("markRead with nonexistent ID is a no-op", () => {
      expect(() => store.markRead("msg-00000000")).not.toThrow();
    });
  });
});
