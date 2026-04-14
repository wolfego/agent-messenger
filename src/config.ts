import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

/** Known environments. Any string is accepted via --env for forward compatibility. */
export type AgentEnv = "cursor" | "codex" | "windsurf" | "aider" | "term" | "ext" | "unknown" | (string & {});

export interface Config {
  baseId: string;
  agentId: string;
  agentName: string;
  beadsDir?: string;
  channel?: string;
  projectRoot?: string;
  env: AgentEnv;
}

function detectEnv(): AgentEnv {
  const env = process.env;

  // Cursor's own agent (Composer/Agent mode) sets CURSOR_AGENT=1
  if (env["CURSOR_AGENT"] === "1") return "cursor";

  // Windsurf (Codeium) sets WINDSURF=1 or has its own env marker
  if (env["WINDSURF"] === "1" || env["CODEIUM_AGENT"] === "1") return "windsurf";

  // Codex CLI sets CODEX_CLI=1 when spawning subprocesses
  if (env["CODEX_CLI"] === "1") return "codex";

  // VS Code extension host (Claude Code tab in Cursor/VS Code)
  // Has VSCODE_PID and extension-host in process title, but no CURSOR_AGENT
  const procTitle = env["VSCODE_PROCESS_TITLE"] ?? "";
  if (env["VSCODE_PID"] && procTitle.includes("extension-host")) return "ext";

  // Terminal embedded in an IDE — has VSCODE_PID but no extension-host marker
  if (env["VSCODE_PID"]) return "term";

  // Standalone terminal — no IDE env vars at all
  if (env["TERM"] || env["TERM_PROGRAM"] || process.stdin.isTTY) return "term";

  return "unknown";
}

function generateSessionSuffix(baseId: string, env: AgentEnv): string {
  const rand = randomBytes(1).toString("hex"); // 2 hex chars for uniqueness
  if (env !== "unknown" && !baseId.includes(env)) return `${env}-${rand}`;
  return randomBytes(2).toString("hex");
}

function formatName(id: string): string {
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function detectBeadsDir(): { beadsDir: string; projectRoot: string } | undefined {
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    const candidate = join(dir, ".beads");
    if (existsSync(candidate)) {
      return { beadsDir: candidate, projectRoot: dir };
    }
    dir = dirname(dir);
  }
  return undefined;
}

export function parseConfig(): Config {
  const args = process.argv.slice(2);
  let baseId = process.env["AGENT_MESSENGER_ID"] ?? "unknown";
  let beadsDir: string | undefined;
  let channel: string | undefined;
  let noAutoId = false;

  let explicitEnv: AgentEnv | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent-id" && args[i + 1]) {
      baseId = args[i + 1]!;
      i++;
    } else if (args[i] === "--beads-dir" && args[i + 1]) {
      beadsDir = resolve(args[i + 1]!);
      i++;
    } else if (args[i] === "--channel" && args[i + 1]) {
      channel = args[i + 1]!;
      i++;
    } else if (args[i] === "--env" && args[i + 1]) {
      explicitEnv = args[i + 1] as AgentEnv;
      i++;
    } else if (args[i] === "--no-auto-id") {
      noAutoId = true;
    }
  }

  if (beadsDir && !beadsDir.endsWith(".beads")) {
    beadsDir = resolve(beadsDir, ".beads");
  }

  let projectRoot: string | undefined;

  if (!beadsDir) {
    const detected = detectBeadsDir();
    if (detected) {
      beadsDir = detected.beadsDir;
      projectRoot = detected.projectRoot;
    }
  } else {
    projectRoot = beadsDir.endsWith(".beads")
      ? dirname(beadsDir)
      : beadsDir;
  }

  const env = explicitEnv ?? detectEnv();
  const suffix = noAutoId ? "" : `-${generateSessionSuffix(baseId, env)}`;
  const agentId = `${baseId}${suffix}`;
  const agentName = formatName(agentId);

  return { baseId, agentId, agentName, beadsDir, channel, projectRoot, env };
}
