import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "../src/config.js";
import type { BeadsMessage } from "../src/beads.js";

// Integration tests require bd and dolt on PATH
// Skip gracefully if not available
function hasBd(): boolean {
  try {
    execFileSync("bd", ["--version"], {
      encoding: "utf-8",
      timeout: 5_000,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

const canRun = hasBd();

describe.skipIf(!canRun)("integration: full message cycle", () => {
  let tmpDir: string;
  let beadsDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "am-test-"));
    beadsDir = join(tmpDir, ".beads");

    // Initialize beads in temp directory
    execFileSync("bd", ["init", "--server"], {
      cwd: tmpDir,
      encoding: "utf-8",
      timeout: 30_000,
      windowsHide: true,
      env: { ...process.env },
    });
  }, 60_000);

  afterAll(() => {
    try {
      // Try to stop dolt server if running in beadsDir
      execFileSync("bd", ["dolt", "stop"], {
        cwd: tmpDir,
        encoding: "utf-8",
        timeout: 10_000,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // Ignore — may not be running
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  function makeConfig(agentId: string, channel?: string): Config {
    return {
      baseId: agentId,
      agentId,
      agentName: agentId,
      beadsDir,
      channel,
    };
  }

  it("send → inbox → reply → thread → mark_read full cycle", async () => {
    const {
      createMessage,
      checkInbox,
      replyToMessage,
      getThread,
      markRead,
    } = await import("../src/beads.js");

    const cursorConfig = makeConfig("cursor-opus");
    const ccConfig = makeConfig("claude-code");

    // 1. Cursor sends a message to Claude Code
    const sent = createMessage(cursorConfig, {
      to: "claude-code",
      subject: "Test message",
      body: "Hello from cursor",
    });
    expect(sent.id).toBeTruthy();
    expect(sent.title).toBe("Test message");

    // 2. Claude Code checks inbox and sees the message
    const inbox = checkInbox(ccConfig);
    const found = inbox.find((m) => m.id === sent.id);
    expect(found).toBeDefined();
    expect(found!.labels).toContain("to:claude-code");
    expect(found!.labels).toContain("from:cursor-opus");
    expect(found!.labels).toContain("unread");

    // 3. Claude Code replies
    const reply = replyToMessage(ccConfig, {
      messageId: sent.id,
      body: "Hello back from CC",
    });
    expect(reply.id).toBeTruthy();
    expect(reply.title).toBe("Re: Test message");

    // 4. Get thread from any message in it
    const thread = getThread(ccConfig, reply.id);
    expect(thread.length).toBeGreaterThanOrEqual(2);
    const threadIds = thread.map((m) => m.id);
    expect(threadIds).toContain(sent.id);
    expect(threadIds).toContain(reply.id);

    // 5. Mark the original message as read
    markRead(ccConfig, sent.id);
    const inboxAfter = checkInbox(ccConfig, false);
    const stillUnread = inboxAfter.find((m) => m.id === sent.id);
    // Should not appear in unread inbox anymore
    expect(stillUnread).toBeUndefined();
  });

  it("channel isolation: messages on different channels don't cross", async () => {
    const { createMessage, checkInbox } = await import("../src/beads.js");

    const senderA = makeConfig("agent-a", "channel-1");
    const senderB = makeConfig("agent-b", "channel-2");
    const receiverCh1 = makeConfig("receiver", "channel-1");
    const receiverCh2 = makeConfig("receiver", "channel-2");

    // Send on channel-1
    createMessage(senderA, {
      to: "receiver",
      subject: "Channel 1 msg",
      body: "On channel 1",
    });

    // Send on channel-2
    createMessage(senderB, {
      to: "receiver",
      subject: "Channel 2 msg",
      body: "On channel 2",
    });

    // Receiver on channel-1 should only see channel-1 messages
    const ch1Inbox = checkInbox(receiverCh1);
    expect(ch1Inbox.some((m) => m.title === "Channel 1 msg")).toBe(true);
    expect(ch1Inbox.some((m) => m.title === "Channel 2 msg")).toBe(false);

    // Receiver on channel-2 should only see channel-2 messages
    const ch2Inbox = checkInbox(receiverCh2);
    expect(ch2Inbox.some((m) => m.title === "Channel 2 msg")).toBe(true);
    expect(ch2Inbox.some((m) => m.title === "Channel 1 msg")).toBe(false);
  });

  it("base ID routing: messages to base ID are visible to session ID instances", async () => {
    const { createMessage, checkInbox } = await import("../src/beads.js");

    const sender = makeConfig("sender-agent");

    // Send to base ID "target"
    createMessage(sender, {
      to: "target",
      subject: "Base ID test",
      body: "Sent to base ID",
    });

    // A session-ID instance (target-abcd) with baseId "target" should see it
    const sessionConfig: Config = {
      baseId: "target",
      agentId: "target-abcd",
      agentName: "Target Abcd",
      beadsDir,
      channel: undefined,
    };
    const inbox = checkInbox(sessionConfig);
    expect(inbox.some((m) => m.title === "Base ID test")).toBe(true);
  });
});
