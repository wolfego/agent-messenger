import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MessageStore } from "../src/message-store.js";

describe("integration: MessageStore full message cycle", () => {
  let tmpDir: string;
  let store: MessageStore;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "am-integ-test-"));
    store = new MessageStore(tmpDir);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("send → inbox → reply → thread → mark_read full cycle", () => {
    // 1. Cursor sends a message to Claude Code
    const sent = store.create({
      to: "claude-code",
      from: "cursor-opus",
      subject: "Test message",
      body: "Hello from cursor",
    });
    expect(sent.id).toMatch(/^msg-[0-9a-f]{8}$/);
    expect(sent.subject).toBe("Test message");

    // 2. Claude Code checks inbox and sees the message
    const inbox = store.inbox("claude-code", "claude-code");
    const found = inbox.find((m) => m.id === sent.id);
    expect(found).toBeDefined();
    expect(found!.from).toBe("cursor-opus");
    expect(found!.unread).toBe(true);

    // 3. Claude Code replies
    const reply = store.create({
      to: "cursor-opus",
      from: "claude-code",
      subject: "Re: Test message",
      body: "Hello back from CC",
      reply_to: sent.id,
      thread_id: sent.thread_id,
    });
    expect(reply.id).toBeTruthy();
    expect(reply.subject).toBe("Re: Test message");
    expect(reply.thread_id).toBe(sent.thread_id);

    // 4. Get thread from any message in it
    const thread = store.thread(reply.id);
    expect(thread.length).toBeGreaterThanOrEqual(2);
    const threadIds = thread.map((m) => m.id);
    expect(threadIds).toContain(sent.id);
    expect(threadIds).toContain(reply.id);

    // 5. Mark the original message as read
    store.markRead(sent.id);
    const inboxAfter = store.inbox("claude-code", "claude-code");
    const stillUnread = inboxAfter.find((m) => m.id === sent.id);
    expect(stillUnread).toBeUndefined();
  });

  it("channel isolation: messages on different channels don't cross", () => {
    store.create({
      to: "receiver", from: "agent-a",
      subject: "Channel 1 msg", body: "On channel 1", channel: "channel-1",
    });
    store.create({
      to: "receiver", from: "agent-b",
      subject: "Channel 2 msg", body: "On channel 2", channel: "channel-2",
    });

    const ch1Inbox = store.inbox("receiver", "receiver", { channel: "channel-1" });
    expect(ch1Inbox.some((m) => m.subject === "Channel 1 msg")).toBe(true);
    expect(ch1Inbox.some((m) => m.subject === "Channel 2 msg")).toBe(false);

    const ch2Inbox = store.inbox("receiver", "receiver", { channel: "channel-2" });
    expect(ch2Inbox.some((m) => m.subject === "Channel 2 msg")).toBe(true);
    expect(ch2Inbox.some((m) => m.subject === "Channel 1 msg")).toBe(false);
  });

  it("base ID routing: messages to base ID are visible to session ID instances", () => {
    store.create({
      to: "target", from: "sender-agent",
      subject: "Base ID test", body: "Sent to base ID",
    });

    // A session-ID instance (target-abcd) with baseId "target" should see it
    const inbox = store.inbox("target-abcd", "target");
    expect(inbox.some((m) => m.subject === "Base ID test")).toBe(true);
  });

  it("handles large message bodies without issues", () => {
    const largeBody = "A".repeat(50_000) + "\n" + "B".repeat(50_000);
    const sent = store.create({
      to: "cc", from: "cursor",
      subject: "Large message", body: largeBody,
    });

    const inbox = store.inbox("cc", "cc");
    const found = inbox.find((m) => m.id === sent.id);
    expect(found).toBeDefined();
    expect(found!.body).toBe(largeBody);
    expect(found!.body_size).toBe(Buffer.byteLength(largeBody, "utf-8"));
  });
});
