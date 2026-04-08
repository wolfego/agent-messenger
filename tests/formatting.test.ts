import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Config } from "../src/config.js";
import { handleSetChannel } from "../src/tools/set-channel.js";

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

  describe("label construction in createMessage", () => {
    it("includes to, from, and unread labels", async () => {
      mockExec.mockReturnValue(JSON.stringify({
        id: "msg-001",
        title: "Test",
        status: "open",
        priority: 2,
        issue_type: "message",
        created_at: "2026-04-08T00:00:00Z",
        updated_at: "2026-04-08T00:00:00Z",
      }));

      const { createMessage } = await import("../src/beads.js");
      const config = makeConfig({ agentId: "claude-code-a3f2" });

      createMessage(config, {
        to: "cursor-opus",
        subject: "Hello",
        body: "Test body",
      });

      const callArgs = mockExec.mock.calls[0]![1] as string[];
      const labelsIdx = callArgs.indexOf("--labels");
      const labels = callArgs[labelsIdx + 1]!;

      expect(labels).toContain("to:cursor-opus");
      expect(labels).toContain("from:claude-code-a3f2");
      expect(labels).toContain("unread");
    });

    it("includes action label when action is provided", async () => {
      mockExec.mockReturnValue(JSON.stringify({
        id: "msg-002",
        title: "Review",
        status: "open",
        priority: 2,
        issue_type: "message",
        created_at: "2026-04-08T00:00:00Z",
        updated_at: "2026-04-08T00:00:00Z",
      }));

      const { createMessage } = await import("../src/beads.js");
      const config = makeConfig();

      createMessage(config, {
        to: "cursor-opus",
        subject: "Review this",
        body: "Please review",
        action: "review",
      });

      const callArgs = mockExec.mock.calls[0]![1] as string[];
      const labelsIdx = callArgs.indexOf("--labels");
      const labels = callArgs[labelsIdx + 1]!;

      expect(labels).toContain("action:review");
    });

    it("includes channel label when channel is set", async () => {
      mockExec.mockReturnValue(JSON.stringify({
        id: "msg-003",
        title: "Design",
        status: "open",
        priority: 2,
        issue_type: "message",
        created_at: "2026-04-08T00:00:00Z",
        updated_at: "2026-04-08T00:00:00Z",
      }));

      const { createMessage } = await import("../src/beads.js");
      const config = makeConfig({ channel: "design-review" });

      createMessage(config, {
        to: "cursor-opus",
        subject: "Design feedback",
        body: "Here is my feedback",
      });

      const callArgs = mockExec.mock.calls[0]![1] as string[];
      const labelsIdx = callArgs.indexOf("--labels");
      const labels = callArgs[labelsIdx + 1]!;

      expect(labels).toContain("channel:design-review");
    });

    it("does not include channel label when no channel is set", async () => {
      mockExec.mockReturnValue(JSON.stringify({
        id: "msg-004",
        title: "No channel",
        status: "open",
        priority: 2,
        issue_type: "message",
        created_at: "2026-04-08T00:00:00Z",
        updated_at: "2026-04-08T00:00:00Z",
      }));

      const { createMessage } = await import("../src/beads.js");
      const config = makeConfig({ channel: undefined });

      createMessage(config, {
        to: "cursor-opus",
        subject: "No channel",
        body: "Message without channel",
      });

      const callArgs = mockExec.mock.calls[0]![1] as string[];
      const labelsIdx = callArgs.indexOf("--labels");
      const labels = callArgs[labelsIdx + 1]!;

      expect(labels).not.toContain("channel:");
    });

    it("sets priority 0 for urgent messages", async () => {
      mockExec.mockReturnValue(JSON.stringify({
        id: "msg-005",
        title: "Urgent",
        status: "open",
        priority: 0,
        issue_type: "message",
        created_at: "2026-04-08T00:00:00Z",
        updated_at: "2026-04-08T00:00:00Z",
      }));

      const { createMessage } = await import("../src/beads.js");
      const config = makeConfig();

      createMessage(config, {
        to: "cursor-opus",
        subject: "Urgent",
        body: "This is urgent",
        priority: "urgent",
      });

      const callArgs = mockExec.mock.calls[0]![1] as string[];
      const priorityIdx = callArgs.indexOf("--priority");
      expect(callArgs[priorityIdx + 1]).toBe("0");
    });

    it("sets priority 2 for normal messages", async () => {
      mockExec.mockReturnValue(JSON.stringify({
        id: "msg-006",
        title: "Normal",
        status: "open",
        priority: 2,
        issue_type: "message",
        created_at: "2026-04-08T00:00:00Z",
        updated_at: "2026-04-08T00:00:00Z",
      }));

      const { createMessage } = await import("../src/beads.js");
      const config = makeConfig();

      createMessage(config, {
        to: "cursor-opus",
        subject: "Normal",
        body: "Normal priority",
      });

      const callArgs = mockExec.mock.calls[0]![1] as string[];
      const priorityIdx = callArgs.indexOf("--priority");
      expect(callArgs[priorityIdx + 1]).toBe("2");
    });

    it("appends context files to body", async () => {
      mockExec.mockReturnValue(JSON.stringify({
        id: "msg-007",
        title: "With files",
        status: "open",
        priority: 2,
        issue_type: "message",
        created_at: "2026-04-08T00:00:00Z",
        updated_at: "2026-04-08T00:00:00Z",
      }));

      const { createMessage } = await import("../src/beads.js");
      const config = makeConfig();

      createMessage(config, {
        to: "cursor-opus",
        subject: "With files",
        body: "Check these files",
        contextFiles: ["src/config.ts", "src/beads.ts"],
      });

      const callArgs = mockExec.mock.calls[0]![1] as string[];
      const descIdx = callArgs.indexOf("--description");
      const desc = callArgs[descIdx + 1]!;

      expect(desc).toContain("Check these files");
      expect(desc).toContain("Context files:");
      expect(desc).toContain("- src/config.ts");
      expect(desc).toContain("- src/beads.ts");
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
    it("extracts context files from message description", async () => {
      // Test the extractContextFiles function indirectly through check_inbox handler
      mockExec.mockReturnValue(JSON.stringify([{
        id: "msg-010",
        title: "Test",
        description: "Body text\n\n---\nContext files:\n- src/config.ts\n- src/beads.ts\n",
        status: "open",
        priority: 2,
        issue_type: "message",
        created_at: "2026-04-08T00:00:00Z",
        updated_at: "2026-04-08T00:00:00Z",
        labels: ["to:claude-code", "from:cursor-opus", "unread"],
      }]));

      const { handleCheckInbox } = await import("../src/tools/check-inbox.js");
      const config = makeConfig({
        agentId: "claude-code",
        baseId: "claude-code",
      });

      const handler = handleCheckInbox(config);
      const result = handler({ auto_mark_read: false });
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.messages[0].context_files).toEqual([
        "src/config.ts",
        "src/beads.ts",
      ]);
    });

    it("returns empty array when no context files", async () => {
      mockExec.mockReturnValue(JSON.stringify([{
        id: "msg-011",
        title: "Test",
        description: "Just a body, no files",
        status: "open",
        priority: 2,
        issue_type: "message",
        created_at: "2026-04-08T00:00:00Z",
        updated_at: "2026-04-08T00:00:00Z",
        labels: ["to:claude-code", "from:cursor-opus", "unread"],
      }]));

      const { handleCheckInbox } = await import("../src/tools/check-inbox.js");
      const config = makeConfig({
        agentId: "claude-code",
        baseId: "claude-code",
      });

      const handler = handleCheckInbox(config);
      const result = handler({ auto_mark_read: false });
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.messages[0].context_files).toEqual([]);
    });
  });
});
