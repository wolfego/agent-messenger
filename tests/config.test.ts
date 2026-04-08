import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolve } from "node:path";

// parseConfig reads process.argv directly, so we manipulate it for testing
let parseConfig: typeof import("../src/config.js").parseConfig;

describe("parseConfig", () => {
  let originalArgv: string[];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalArgv = [...process.argv];
    originalEnv = { ...process.env };
    // Re-import each test to get fresh module state
    vi.resetModules();
    const mod = await import("../src/config.js");
    parseConfig = mod.parseConfig;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
  });

  it("uses --agent-id flag for base ID", () => {
    process.argv = ["node", "index.js", "--agent-id", "my-agent"];
    const config = parseConfig();
    expect(config.baseId).toBe("my-agent");
  });

  it("falls back to AGENT_MESSENGER_ID env var", () => {
    process.argv = ["node", "index.js"];
    process.env["AGENT_MESSENGER_ID"] = "env-agent";
    const config = parseConfig();
    expect(config.baseId).toBe("env-agent");
  });

  it("defaults baseId to 'unknown' when no flag or env var", () => {
    process.argv = ["node", "index.js"];
    delete process.env["AGENT_MESSENGER_ID"];
    const config = parseConfig();
    expect(config.baseId).toBe("unknown");
  });

  it("--agent-id takes precedence over env var", () => {
    process.argv = ["node", "index.js", "--agent-id", "flag-agent"];
    process.env["AGENT_MESSENGER_ID"] = "env-agent";
    const config = parseConfig();
    expect(config.baseId).toBe("flag-agent");
  });

  it("appends session suffix by default (4 hex chars)", () => {
    process.argv = ["node", "index.js", "--agent-id", "test"];
    const config = parseConfig();
    expect(config.agentId).toMatch(/^test-[0-9a-f]{4}$/);
    expect(config.agentId).not.toBe("test");
  });

  it("--no-auto-id disables session suffix", () => {
    process.argv = ["node", "index.js", "--agent-id", "test", "--no-auto-id"];
    const config = parseConfig();
    expect(config.agentId).toBe("test");
  });

  it("resolves --beads-dir to absolute path", () => {
    process.argv = ["node", "index.js", "--beads-dir", "some/path/.beads"];
    const config = parseConfig();
    expect(config.beadsDir).toBe(resolve("some/path/.beads"));
  });

  it("auto-appends .beads if --beads-dir doesn't end with it", () => {
    process.argv = ["node", "index.js", "--beads-dir", "some/project"];
    const config = parseConfig();
    expect(config.beadsDir!.endsWith(".beads")).toBe(true);
    expect(config.beadsDir).toBe(resolve("some/project", ".beads"));
  });

  it("does not double-append .beads if already present", () => {
    process.argv = ["node", "index.js", "--beads-dir", "some/project/.beads"];
    const config = parseConfig();
    expect(config.beadsDir).toBe(resolve("some/project/.beads"));
    expect(config.beadsDir!.endsWith(".beads/.beads")).toBe(false);
  });

  it("sets channel from --channel flag", () => {
    process.argv = ["node", "index.js", "--channel", "my-channel"];
    const config = parseConfig();
    expect(config.channel).toBe("my-channel");
  });

  it("leaves channel undefined when not provided", () => {
    process.argv = ["node", "index.js"];
    const config = parseConfig();
    expect(config.channel).toBeUndefined();
  });

  it("leaves beadsDir undefined when not provided", () => {
    process.argv = ["node", "index.js"];
    const config = parseConfig();
    expect(config.beadsDir).toBeUndefined();
  });

  it("generates agentName from agentId with title case", () => {
    process.argv = ["node", "index.js", "--agent-id", "my-agent", "--no-auto-id"];
    const config = parseConfig();
    expect(config.agentName).toBe("My Agent");
  });

  it("handles all flags together", () => {
    process.argv = [
      "node", "index.js",
      "--agent-id", "cursor-opus",
      "--beads-dir", "/tmp/project/.beads",
      "--channel", "design",
      "--no-auto-id",
    ];
    const config = parseConfig();
    expect(config.baseId).toBe("cursor-opus");
    expect(config.agentId).toBe("cursor-opus");
    expect(config.beadsDir).toBe(resolve("/tmp/project/.beads"));
    expect(config.channel).toBe("design");
  });
});
