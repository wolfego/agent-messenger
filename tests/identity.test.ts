import { describe, it, expect } from "vitest";
import type { Config } from "../src/config.js";
import { handleSetIdentity } from "../src/tools/set-identity.js";
import { handleWhoami } from "../src/tools/whoami.js";

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

describe("identity system", () => {
  describe("session ID format", () => {
    it("session suffix includes env hint and random hex", async () => {
      const { parseConfig } = await import("../src/config.js");
      const savedArgv = [...process.argv];
      process.argv = ["node", "index.js", "--agent-id", "test"];
      const config = parseConfig();
      process.argv = savedArgv;

      const suffix = config.agentId.replace("test-", "");
      // Format is <env>-<2hex> when env is detected, or <4hex> when unknown
      expect(suffix).toMatch(/^(.+-[0-9a-f]{2}|[0-9a-f]{4})$/);
    });

    it("generates different session IDs on each call", async () => {
      const { parseConfig } = await import("../src/config.js");
      const savedArgv = [...process.argv];
      process.argv = ["node", "index.js", "--agent-id", "test"];

      const ids = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const config = parseConfig();
        ids.add(config.agentId);
      }
      process.argv = savedArgv;

      // With 4 hex chars (65536 values), 10 calls should be unique
      expect(ids.size).toBeGreaterThan(1);
    });
  });

  describe("set_identity", () => {
    it("changes agentId on config", () => {
      const config = makeConfig();
      const handler = handleSetIdentity(config);
      handler({ name: "cc-design" });

      expect(config.agentId).toBe("cc-design");
    });

    it("updates agentName to title case", () => {
      const config = makeConfig();
      const handler = handleSetIdentity(config);
      handler({ name: "cc-design-review" });

      expect(config.agentName).toBe("Cc Design Review");
    });

    it("preserves baseId", () => {
      const config = makeConfig({ baseId: "claude-code" });
      const handler = handleSetIdentity(config);
      handler({ name: "cc-design" });

      expect(config.baseId).toBe("claude-code");
    });

    it("returns previous and new IDs in response", () => {
      const config = makeConfig({ agentId: "claude-code-a3f2" });
      const handler = handleSetIdentity(config);
      const result = handler({ name: "cc-design" });

      const text = result.content[0]!.text;
      const parsed = JSON.parse(text);
      expect(parsed.status).toBe("ok");
      expect(parsed.previous_id).toBe("claude-code-a3f2");
      expect(parsed.agent_id).toBe("cc-design");
      expect(parsed.base_id).toBe("claude-code");
    });
  });

  describe("whoami", () => {
    it("returns agent_id, base_id, agent_name, and channel", () => {
      const config = makeConfig({
        agentId: "cc-design",
        baseId: "claude-code",
        agentName: "Cc Design",
        channel: "review",
      });
      const handler = handleWhoami(config);
      const result = handler();

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.agent_id).toBe("cc-design");
      expect(parsed.base_id).toBe("claude-code");
      expect(parsed.agent_name).toBe("Cc Design");
      expect(parsed.channel).toBe("review");
    });

    it("returns null channel when not set", () => {
      const config = makeConfig({ channel: undefined });
      const handler = handleWhoami(config);
      const result = handler();

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.channel).toBeNull();
    });

    it("reflects identity changes", () => {
      const config = makeConfig();

      // Set identity
      const setId = handleSetIdentity(config);
      setId({ name: "cc-auth" });

      // Check whoami
      const whoami = handleWhoami(config);
      const result = whoami();
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.agent_id).toBe("cc-auth");
      expect(parsed.base_id).toBe("claude-code");
    });
  });
});
