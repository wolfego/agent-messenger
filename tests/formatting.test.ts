import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "../src/config.js";
import { handleSetChannel } from "../src/tools/set-channel.js";
import { MessageStore } from "../src/message-store.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    baseId: "claude-code",
    agentId: "claude-code-a3f2",
    agentName: "Claude Code A3f2",
    beadsDir: undefined,
    channel: undefined,
    ...overrides,
  };
}

// Mock child_process to intercept bd calls and inspect the labels passed
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
const mockExec = vi.mocked(execFileSync);

describe("message formatting", () => {
  beforeEach(() => {
    mockExec.mockReset();
  });

  describe("metadata in MessageStore.create", () => {
    let storeTmpDir: string;
    let store: MessageStore;

    beforeEach(() => {
      storeTmpDir = mkdtempSync(join(tmpdir(), "am-meta-test-"));
      store = new MessageStore(storeTmpDir);
    });

    afterEach(() => {
      rmSync(storeTmpDir, { recursive: true, force: true });
    });

    it("stores to, from, and unread metadata", () => {
      const meta = store.create({
        to: "cursor-opus", from: "claude-code-a3f2",
        subject: "Hello", body: "Test body",
      });
      expect(meta.to).toBe("cursor-opus");
      expect(meta.from).toBe("claude-code-a3f2");
      expect(meta.unread).toBe(true);
    });

    it("stores action when provided", () => {
      const meta = store.create({
        to: "cursor-opus", from: "claude-code",
        subject: "Review this", body: "Please review",
        action: "review",
      });
      expect(meta.action).toBe("review");
    });

    it("stores channel when set", () => {
      const meta = store.create({
        to: "cursor-opus", from: "claude-code",
        subject: "Design feedback", body: "Here is my feedback",
        channel: "design-review",
      });
      expect(meta.channel).toBe("design-review");
    });

    it("channel is null when not set", () => {
      const meta = store.create({
        to: "cursor-opus", from: "claude-code",
        subject: "No channel", body: "Message without channel",
      });
      expect(meta.channel).toBeNull();
    });

    it("stores urgent priority", () => {
      const meta = store.create({
        to: "cursor-opus", from: "claude-code",
        subject: "Urgent", body: "This is urgent",
        priority: "urgent",
      });
      expect(meta.priority).toBe("urgent");
    });

    it("defaults to normal priority", () => {
      const meta = store.create({
        to: "cursor-opus", from: "claude-code",
        subject: "Normal", body: "Normal priority",
      });
      expect(meta.priority).toBe("normal");
    });

    it("stores context_files metadata", () => {
      const meta = store.create({
        to: "cursor-opus", from: "claude-code",
        subject: "With files", body: "Check these files",
        context_files: ["src/config.ts", "src/beads.ts"],
      });
      expect(meta.context_files).toEqual(["src/config.ts", "src/beads.ts"]);
    });
  });

  describe("channel label generation", () => {
    it("set_channel sets config.channel", () => {
      const config = makeConfig();
      const handler = handleSetChannel(config);
      handler({ channel: "design-review" });

      expect(config.channel).toBe("design-review");
    });

    it("set_channel with empty string clears channel", () => {
      const config = makeConfig({ channel: "old-channel" });
      const handler = handleSetChannel(config);
      handler({ channel: "" });

      expect(config.channel).toBeUndefined();
    });

    it("set_channel returns status ok with channel name", () => {
      const config = makeConfig();
      const handler = handleSetChannel(config);
      const result = handler({ channel: "impl-auth" });

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.status).toBe("ok");
      expect(parsed.channel).toBe("impl-auth");
    });

    it("set_channel clear returns null channel", () => {
      const config = makeConfig({ channel: "old" });
      const handler = handleSetChannel(config);
      const result = handler({ channel: "" });

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.status).toBe("ok");
      expect(parsed.channel).toBeNull();
    });
  });

  describe("extractContextFiles (via check_inbox handler)", () => {
    let storeTmpDir: string;
    let store: MessageStore;

    beforeEach(() => {
      storeTmpDir = mkdtempSync(join(tmpdir(), "am-fmt-test-"));
      store = new MessageStore(storeTmpDir);
    });

    afterEach(() => {
      rmSync(storeTmpDir, { recursive: true, force: true });
    });

    it("extracts context files from message body", async () => {
      store.create({
        to: "claude-code",
        from: "cursor-opus",
        subject: "Test",
        body: "Body text\n\n---\nContext files:\n- src/config.ts\n- src/beads.ts\n",
      });

      const { handleCheckInbox } = await import("../src/tools/check-inbox.js");
      const config = makeConfig({
        agentId: "claude-code",
        baseId: "claude-code",
      });

      const handler = handleCheckInbox(config, store);
      const result = handler({ auto_mark_read: false });
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.messages[0].context_files).toEqual([
        "src/config.ts",
        "src/beads.ts",
      ]);
    });

    it("returns empty array when no context files", async () => {
      store.create({
        to: "claude-code",
        from: "cursor-opus",
        subject: "Test",
        body: "Just a body, no files",
      });

      const { handleCheckInbox } = await import("../src/tools/check-inbox.js");
      const config = makeConfig({
        agentId: "claude-code",
        baseId: "claude-code",
      });

      const handler = handleCheckInbox(config, store);
      const result = handler({ auto_mark_read: false });
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.messages[0].context_files).toEqual([]);
    });
  });
});
