import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const cliEntry = join(projectRoot, "dist", "cli", "index.js");
const beadsDir = join(projectRoot, ".beads");

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
const cliBuilt = existsSync(cliEntry);

describe.skipIf(!cliBuilt)("CLI: init --dry-run", () => {
  it("produces expected output without writing files", () => {
    const output = execFileSync("node", [cliEntry, "init", "--dry-run"], {
      encoding: "utf-8",
      timeout: 15_000,
      cwd: projectRoot,
      windowsHide: true,
      env: { ...process.env },
    });

    // Should mention dry run mode
    expect(output).toContain("DRY RUN");
    // Should mention key files it would create
    expect(output).toContain("mcp.json");
    expect(output).toContain("agent-messenger");
    // Should show steps
    expect(output).toContain("Step 1");
    expect(output).toContain("Step 2");
    expect(output).toContain("Step 3");
  });

  it("mentions Cursor and CC MCP configs", () => {
    const output = execFileSync("node", [cliEntry, "init", "--dry-run"], {
      encoding: "utf-8",
      timeout: 15_000,
      cwd: projectRoot,
      windowsHide: true,
      env: { ...process.env },
    });

    // Should reference both agent types
    expect(output).toContain("cursor-opus");
    expect(output).toContain("claude-code");
  });

  it("respects custom agent IDs", () => {
    const output = execFileSync(
      "node",
      [cliEntry, "init", "--dry-run", "--cursor-id", "my-cursor", "--cc-id", "my-cc"],
      {
        encoding: "utf-8",
        timeout: 15_000,
        cwd: projectRoot,
        windowsHide: true,
        env: { ...process.env },
      }
    );

    expect(output).toContain("my-cursor");
    expect(output).toContain("my-cc");
  });
});

describe.skipIf(!cliBuilt || !canRun)("CLI: doctor", () => {
  it("runs and reports results on this project", () => {
    let output: string;
    let exitCode = 0;

    try {
      output = execFileSync("node", [cliEntry, "doctor"], {
        encoding: "utf-8",
        timeout: 30_000,
        cwd: projectRoot,
        windowsHide: true,
        env: { ...process.env },
      });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      output = (e.stdout ?? "") + (e.stderr ?? "");
      exitCode = e.status ?? 1;
    }

    // Should contain section headers
    expect(output).toContain("agent-messenger doctor");
    expect(output).toContain("PREREQUISITES");
    expect(output).toContain("MCP CONFIGS");

    // Should detect Node.js
    expect(output).toMatch(/Node\.js/);
  });

  it("checks for beads database", () => {
    let output: string;
    try {
      output = execFileSync("node", [cliEntry, "doctor"], {
        encoding: "utf-8",
        timeout: 30_000,
        cwd: projectRoot,
        windowsHide: true,
        env: { ...process.env },
      });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string };
      output = (e.stdout ?? "") + (e.stderr ?? "");
    }

    expect(output).toContain("BEADS DATABASE");
    if (existsSync(beadsDir)) {
      expect(output).toContain(".beads/");
    }
  });

  it("shows summary with pass/warning/error counts", () => {
    let output: string;
    try {
      output = execFileSync("node", [cliEntry, "doctor"], {
        encoding: "utf-8",
        timeout: 30_000,
        cwd: projectRoot,
        windowsHide: true,
        env: { ...process.env },
      });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string };
      output = (e.stdout ?? "") + (e.stderr ?? "");
    }

    // Should have a summary line with counts
    expect(output).toMatch(/\d+ passed/);
    expect(output).toMatch(/\d+ warnings/);
    expect(output).toMatch(/\d+ errors/);
  });
});
