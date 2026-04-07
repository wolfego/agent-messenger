import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { platform, homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let passed = 0;
let warnings = 0;
let errors = 0;

function pass(msg: string): void {
  console.log(`  ✓  ${msg}`);
  passed++;
}

function warn(msg: string, hint?: string): void {
  console.log(`  ⚠  ${msg}`);
  if (hint) console.log(`      ${hint}`);
  warnings++;
}

function fail(msg: string, hint?: string): void {
  console.log(`  ✖  ${msg}`);
  if (hint) console.log(`      ${hint}`);
  errors++;
}

function which(cmd: string): string | null {
  try {
    const out = execSync(
      platform() === "win32" ? `where ${cmd}` : `which ${cmd}`,
      { encoding: "utf-8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
    return out.trim().split(/\r?\n/)[0] ?? null;
  } catch {
    return null;
  }
}

function getVersion(cmd: string): string | null {
  try {
    const out = execFileSync(cmd, ["--version"], {
      encoding: "utf-8",
      timeout: 10_000,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const match = out.match(/\d+\.\d+\.\d+/);
    return match?.[0] ?? out.trim();
  } catch {
    return null;
  }
}

function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

function checkJsonField(path: string, field: string): unknown {
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    const parts = field.split(".");
    let current: unknown = data;
    for (const part of parts) {
      if (current && typeof current === "object" && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return current;
  } catch {
    return undefined;
  }
}

function getServerEntryPath(): string {
  const distRoot = join(__dirname, "..");
  return join(distRoot, "index.js");
}

export async function doctor(_args: string[]): Promise<void> {
  const projectRoot = findProjectRoot();
  const beadsDir = join(projectRoot, ".beads");

  console.log("\nagent-messenger doctor");
  console.log(`  Project: ${projectRoot}\n`);

  // 1. Prerequisites
  console.log("PREREQUISITES");
  const nodeVer = getVersion("node");
  if (nodeVer) pass(`Node.js ${nodeVer}`);
  else fail("Node.js not found", "Install from https://nodejs.org");

  const bdPath = which("bd");
  if (bdPath) {
    const bdVer = getVersion("bd");
    pass(`Beads (bd) ${bdVer ?? "installed"} — ${bdPath}`);
  } else {
    fail("Beads (bd) not on PATH", "Install: npm install -g @beads/bd or download from GitHub releases");
  }

  const doltPath = which("dolt");
  if (doltPath) {
    const doltVer = getVersion("dolt");
    pass(`Dolt ${doltVer ?? "installed"} — ${doltPath}`);
  } else {
    fail("Dolt not on PATH", "Install: https://docs.dolthub.com/introduction/installation");
  }

  // 2. Beads database
  console.log("\nBEADS DATABASE");
  if (existsSync(beadsDir)) {
    pass(`.beads/ exists at ${beadsDir}`);
  } else {
    fail(".beads/ not found", "Run: agent-messenger init  (or: bd init --server)");
  }

  if (existsSync(join(beadsDir, "config.yaml"))) {
    pass(".beads/config.yaml present");
  } else if (existsSync(beadsDir)) {
    warn(".beads/config.yaml missing — database may be corrupt");
  }

  if (bdPath && existsSync(beadsDir)) {
    try {
      execFileSync("bd", ["list", "--type", "message", "--json"], {
        cwd: projectRoot,
        encoding: "utf-8",
        timeout: 10_000,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      pass("Dolt server reachable (bd list succeeded)");
    } catch (err: unknown) {
      const e = err as { stderr?: string };
      if (e.stderr?.includes("bad connection") || e.stderr?.includes("unreachable")) {
        fail("Dolt server not running", "Run: bd dolt start");
      } else {
        warn(`bd list failed: ${e.stderr?.slice(0, 100) ?? "unknown error"}`);
      }
    }
  }

  // 3. MCP configs
  console.log("\nMCP CONFIGS");
  const serverEntry = getServerEntryPath();
  if (existsSync(serverEntry)) {
    pass(`MCP server entry: ${serverEntry}`);
  } else {
    fail(`MCP server entry not found: ${serverEntry}`, "Run: npm run build");
  }

  const projectCursorMcp = join(projectRoot, ".cursor", "mcp.json");
  const projectCcMcp = join(projectRoot, ".mcp.json");
  const userCursorMcp = join(homedir(), ".cursor", "mcp.json");

  for (const [label, path] of [
    ["Project .cursor/mcp.json", projectCursorMcp],
    ["Project .mcp.json (CC)", projectCcMcp],
    ["User ~/.cursor/mcp.json", userCursorMcp],
  ] as const) {
    if (!existsSync(path)) {
      if (label.startsWith("User")) {
        warn(`${label} not found (optional fallback)`, "Run: agent-messenger init");
      } else {
        fail(`${label} not found`, "Run: agent-messenger init");
      }
      continue;
    }

    const entry = checkJsonField(path, "mcpServers.agent-messenger");
    if (entry) {
      pass(`${label} — agent-messenger entry present`);
      const args = (entry as Record<string, unknown>)["args"] as string[] | undefined;
      if (args) {
        const bdIdx = args.indexOf("--beads-dir");
        if (bdIdx >= 0 && args[bdIdx + 1]) {
          const bdArg = args[bdIdx + 1]!;
          if (existsSync(bdArg)) {
            pass(`  --beads-dir points to existing path`);
          } else {
            fail(`  --beads-dir path does not exist: ${bdArg}`);
          }
          if (!bdArg.endsWith(".beads")) {
            warn(`  --beads-dir should end with .beads (got: ${bdArg})`, "Should point to <project>/.beads, not the project root");
          }
        } else {
          warn(`  No --beads-dir flag — bd will use cwd which may not be the project root`);
        }
      }
    } else {
      fail(`${label} exists but missing agent-messenger entry`);
    }
  }

  // 4. Cursor rule and CC skills
  console.log("\nAGENT CONFIGS");
  const cursorRule = join(projectRoot, ".cursor", "rules", "agent-messenger.mdc");
  if (existsSync(cursorRule)) {
    pass("Cursor rule: .cursor/rules/agent-messenger.mdc");
  } else {
    warn("Cursor rule not found", "Run: agent-messenger init");
  }

  const skills = ["am", "cm", "sm", "ch", "wi"];
  for (const skill of skills) {
    const skillPath = join(projectRoot, ".claude", "skills", skill, "SKILL.md");
    if (existsSync(skillPath)) {
      pass(`CC skill: .claude/skills/${skill}/SKILL.md`);
    } else {
      warn(`CC skill missing: .claude/skills/${skill}/SKILL.md`, "Run: agent-messenger init");
    }
  }

  // 5. Server startup test
  console.log("\nSERVER TEST");
  if (existsSync(serverEntry) && existsSync(beadsDir)) {
    try {
      execFileSync("node", [serverEntry, "--agent-id", "doctor-test", "--beads-dir", beadsDir], {
        encoding: "utf-8",
        timeout: 3_000,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const e = err as { stderr?: string; killed?: boolean };
      if (e.killed || e.stderr?.includes("MCP started")) {
        pass("MCP server starts successfully");
      } else {
        fail(`MCP server failed to start: ${e.stderr?.slice(0, 200) ?? ""}`, "Check: node " + serverEntry + " --agent-id test --beads-dir " + beadsDir);
      }
    }
  } else {
    warn("Skipped server test (missing server entry or .beads/)");
  }

  // Summary
  console.log(`\n  ${passed} passed  ${warnings} warnings  ${errors} errors\n`);

  if (errors > 0) {
    console.log("  Fix the errors above, then run: agent-messenger doctor\n");
    process.exit(1);
  }
}
