import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface InitOptions {
  cursorId: string;
  ccId: string;
  dryRun: boolean;
  skipBeads: boolean;
  force: boolean;
}

function parseArgs(args: string[]): InitOptions {
  const opts: InitOptions = {
    cursorId: "cursor-opus",
    ccId: "claude-code",
    dryRun: false,
    skipBeads: false,
    force: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cursor-id" && args[i + 1]) {
      opts.cursorId = args[i + 1]!;
      i++;
    } else if (args[i] === "--cc-id" && args[i + 1]) {
      opts.ccId = args[i + 1]!;
      i++;
    } else if (args[i] === "--dry-run") {
      opts.dryRun = true;
    } else if (args[i] === "--skip-beads") {
      opts.skipBeads = true;
    } else if (args[i] === "--force") {
      opts.force = true;
    }
  }
  return opts;
}

function log(icon: string, msg: string): void {
  console.log(`  ${icon}  ${msg}`);
}

function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
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

type WriteResult = "created" | "updated" | "unchanged" | "skipped";

function writeFileSafe(path: string, content: string, dryRun: boolean, force: boolean): WriteResult {
  if (dryRun) {
    log("📄", `Would create: ${path}`);
    return "created";
  }

  if (existsSync(path)) {
    const existing = readFileSync(path, "utf-8");
    if (existing === content) {
      log("—", `Unchanged: ${path}`);
      return "unchanged";
    }
    if (!force) {
      log("⚠", `Skipped (customized): ${path}`);
      return "skipped";
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf-8");
    log("✓", `Updated: ${path}`);
    return "updated";
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
  log("✓", `Created: ${path}`);
  return "created";
}

function mergeJsonFile(path: string, key: string, value: unknown, dryRun: boolean): void {
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  const mcpServers = (existing["mcpServers"] ?? {}) as Record<string, unknown>;
  mcpServers[key] = value;
  existing["mcpServers"] = mcpServers;

  if (dryRun) {
    log("📄", `Would write/merge: ${path}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  log("✓", `Wrote: ${path}`);
}

function ensureGitignoreEntry(gitignorePath: string, entry: string, dryRun: boolean): void {
  if (dryRun) {
    log("📄", `Would add '${entry}' to ${gitignorePath}`);
    return;
  }
  let content = "";
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, "utf-8");
  }
  if (!content.split(/\r?\n/).some(line => line.trim() === entry)) {
    appendFileSync(gitignorePath, `\n${entry}\n`, "utf-8");
    log("✓", `Added '${entry}' to .gitignore`);
  } else {
    log("—", `'${entry}' already in .gitignore`);
  }
}

function getServerEntryPath(): string {
  // When installed via npm, the CLI is in dist/cli/index.js
  // The MCP server entry is at dist/index.js (sibling to cli/)
  const distCli = resolve(__dirname);
  const distRoot = resolve(distCli, "..");
  const serverEntry = join(distRoot, "index.js");
  if (existsSync(serverEntry)) return serverEntry;
  // Fallback: resolve from package location
  return resolve(__dirname, "..", "index.js");
}

const CURSOR_RULE = `---
description: Agent-to-agent messaging via agent-messenger MCP
globs:
alwaysApply: true
---

# Agent Messenger

You have access to the \`agent-messenger\` MCP server for communicating with other AI agents (e.g. Claude Code running in a terminal).

## Auto-check on conversation start

At the **start of each new conversation** (your very first response), call \`check_inbox\` once — UNLESS the user's first message is a shortcut command (#id, #sm, #ch, #wi, #la, #ct, #lt, #st, #rt). In that case, execute the command directly without checking inbox.

- If the inbox is empty, say nothing about it — proceed with the user's request normally.
- If there are unread messages, summarize them briefly to the user (e.g. "You have a message from claude-code about X") and act on any that have an \`action\` field (review, brainstorm, implement, reply). Messages are automatically marked read when fetched.
- Do NOT check inbox on subsequent turns unless the user asks.

## Shortcuts

The user may type these short commands instead of full sentences:

- \`#help\` — Show this list of available commands.
- \`#cm\` — Check messages. Call \`check_inbox\`, act on any unread messages. If empty, say "No new messages."
- \`#sm\` — Send message. Ask the user who to send to (default: "claude-code") and what to say. Use \`send_message\`.
- \`#ch\` — Set channel. Ask the user which channel to join. Call \`set_channel\`.
- \`#id\` — Set identity. Ask the user for a name (e.g. "cursor-design"). Call \`set_identity\`.
- \`#wi\` — Who am I. Call \`whoami\` and report identity, base ID, and channel.
- \`#ct\` — Create task. Ask for title and optional details, then call \`create_task\`.
- \`#lt\` — List tasks. Call \`list_tasks\` with sensible defaults (open tasks, sorted by priority).
- \`#st\` — Show task. Ask for task ID, then call \`show_task\`.
- \`#rt\` — Ready tasks. Call \`list_tasks\` with \`ready_only: true\` to show tasks with no blockers.
- \`#la\` — List agents. Call \`list_agents\` to see who is currently online in this project.
- \`#log\` — Message history. Call \`query_beads\` with \`type: "message"\` and \`limit: 20\`. If the user specifies an agent name, pass it as \`from\`. Show a concise summary: timestamp, from, to, subject.

## Sending messages

When the user asks you to send something to another agent, or when your workflow would benefit from another agent's input, use \`send_message\`. Always include:
- A clear \`subject\` summarizing the request
- The \`action\` field so the recipient knows what to do
- \`context_files\` if the recipient needs to read specific files

## Replying

When acting on a received message, always use \`reply\` (not \`send_message\`) to maintain the conversation thread.

## Channels (multi-agent isolation)

If the user has multiple agent windows/terminals open in the same project, use \`set_channel\` to pair with a specific counterpart. Both agents must join the same channel name. When a channel is active, only messages on that channel appear in your inbox.

If the user says something like "set channel to design-review" or "join channel impl", call \`set_channel\` with that name.

## Identity

Each agent gets a unique session ID on startup (e.g. \`cursor-opus-a3f2\`). The base ID (\`cursor-opus\`) is shared across instances — messages to the base ID reach all of them. Use \`set_identity\` to pick a memorable name (e.g. \`cursor-design\`).

Use \`whoami\` to see your current identity, base ID, and channel. You do not need to self-identify in message bodies — the \`from\` label is set automatically.
`;

function skillContent(name: string, description: string, body: string, disableInvocation = true): string {
  const frontmatter = disableInvocation
    ? `---\nname: ${name}\ndescription: ${description}\ndisable-model-invocation: true\n---`
    : `---\nname: ${name}\ndescription: ${description}\n---`;
  return `${frontmatter}\n\n${body}\n`;
}

const SKILLS: Array<{ name: string; description: string; body: string; noInvoke?: boolean }> = [
  {
    name: "am",
    description: 'Show available agent-messenger commands. Use when the user says "/am", asks about messaging commands, or wants to know how to communicate with other agents.',
    body: `Show the user this list of available agent-messenger commands:

**Messaging:**

| Command | Description |
|---------|-------------|
| \`/am\`   | Show this list of commands |
| \`/cm\`   | Check messages — read inbox and act on unread messages |
| \`/sm\`   | Send message — prompts for recipient and content |
| \`/ch\`   | Set channel — join a channel for multi-agent isolation |
| \`/id\`   | Set identity — rename yourself (e.g. \`cc-design\`) |
| \`/wi\`   | Who am I — show agent identity, base ID, and current channel |

**Tasks:**

| Command | Description |
|---------|-------------|
| \`/ct\`   | Create task — prompts for title and details |
| \`/lt\`   | List tasks — show open tasks sorted by priority |
| \`/st\`   | Show task — prompts for task ID, shows full details |
| \`/rt\`   | Ready tasks — show tasks with no blockers |
| \`/la\`   | List agents — show who is currently online |
| \`/log\`  | Message history — browse recent messages, optionally filter by sender |

**Identity:** Each agent gets a unique session ID on startup (e.g. \`claude-code-a3f2\`). Messages to your base ID (\`claude-code\`) reach all instances. Use \`/id\` to pick a memorable name like \`cc-design\`.

Messages are automatically marked as read when you check your inbox.`,
  },
  {
    name: "cm",
    description: 'Check agent-messenger inbox for new messages. Use when the user says "check messages", "#cm", or asks about incoming messages from other agents.',
    body: 'Check your agent-messenger inbox using the `check_inbox` MCP tool. If there are unread messages, read each one and act on any that have an `action` field (review, brainstorm, implement, reply). Messages are automatically marked read when fetched. If the inbox is empty, just say "No new messages."\n\nIf this is your first turn and you haven\'t set an identity yet, call `set_identity` with a short name reflecting your current task (e.g. `cc-web-ui`, `cc-auth-tests`). Derive the name from the user\'s first message or the task context.',
  },
  {
    name: "sm",
    description: 'Send a message to another agent via agent-messenger. Use when the user says "send message", "#sm", or wants to communicate with Cursor or another agent.',
    body: 'Send a message to another agent using the `send_message` MCP tool. Ask the user who to send to (default: "cursor-opus") and what the message should contain. Include a clear subject, the action the recipient should take, and any relevant context_files.',
  },
  {
    name: "ch",
    description: 'Set or change the messaging channel for multi-agent isolation. Use when the user says "set channel", "#ch", or wants to pair with a specific agent.',
    body: "Set or change the messaging channel using the `set_channel` MCP tool. Ask the user which channel to join. Both agents must be on the same channel to see each other's messages. Use an empty string to clear the channel and see all messages.",
  },
  {
    name: "id",
    description: 'Set agent identity. Use when the user says "/id" or asks to rename the agent.',
    body: "Ask the user what name they'd like for this agent instance (suggest something descriptive like `cc-design`, `cc-auth`, `cc-review`). Then call the `set_identity` MCP tool with that name. Report back the new identity.",
  },
  {
    name: "wi",
    description: 'Check agent identity and current channel. Use when the user says "who am I", "#wi", or wants to verify agent configuration.',
    body: "Check your agent identity and current channel using the `whoami` MCP tool. Report your agent ID, session ID, base ID, and active channel (if any).",
  },
  {
    name: "ct",
    description: 'Create a new task. Use when the user says "/ct", "create task", or wants to track new work.',
    body: "Create a new task using the `create_task` MCP tool. Ask the user for a title and optionally: description, priority (P0-P4), type (task/bug/feature/epic/chore), labels, parent issue ID, and assignee. Report the created task ID.",
  },
  {
    name: "lt",
    description: 'List tasks. Use when the user says "/lt", "list tasks", or wants to see current work items.',
    body: "List tasks using the `list_tasks` MCP tool. Default to open tasks sorted by priority. If the user asks for specific filters (status, assignee, label), pass those along. Show a concise summary: ID, title, status, priority, assignee.",
  },
  {
    name: "st",
    description: 'Show task details. Use when the user says "/st", "show task", or asks about a specific task.',
    body: "Show task details using the `show_task` MCP tool. Ask the user for the task ID. Report all available fields: title, description, status, priority, assignee, labels, dependencies, and notes.",
  },
  {
    name: "rt",
    description: 'Show ready tasks (no blockers). Use when the user says "/rt", "ready tasks", or wants to know what to work on next.',
    body: "List ready tasks using the `list_tasks` MCP tool with `ready_only: true`. These are open tasks with no unresolved blockers. Show a concise summary: ID, title, priority, assignee.",
  },
  {
    name: "la",
    description: 'List online agents. Use when the user says "/la", "list agents", "who is online", or wants to see active agents in this project.',
    body: "List online agents using the `list_agents` MCP tool. Show each agent's ID, base ID, channel (if any), and when they were last seen. If an agent appears stale, mention that they may no longer be active.",
  },
  {
    name: "log",
    description: 'Show message history. Use when the user says "/log", "show messages", "message history", or wants to review past agent conversations.',
    body: "Show recent message history using the `query_beads` MCP tool with `type: \"message\"` and `limit: 20`. If the user specifies an agent name (e.g. `/log cc-debug`), pass it as the `from` parameter. Show a concise summary for each message: timestamp, from, to, subject. If the user wants more detail on a specific message, use `get_thread` with its ID.",
  },
];

export async function init(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  const projectRoot = findProjectRoot();
  const beadsDir = join(projectRoot, ".beads");
  const serverEntry = getServerEntryPath();

  const isUpgrade = existsSync(join(projectRoot, ".cursor", "rules", "agent-messenger.mdc"))
    || existsSync(join(projectRoot, ".cursor", "mcp.json"));

  console.log("\nagent-messenger init");
  console.log(`  Project: ${projectRoot}`);
  console.log(`  Server:  ${serverEntry}`);
  console.log(`  Cursor agent ID: ${opts.cursorId}`);
  console.log(`  CC agent ID:     ${opts.ccId}`);
  if (isUpgrade) console.log("  Mode: UPGRADE (existing install detected — Beads data is safe)");
  if (opts.force) console.log("  Flag: --force (will overwrite customized rules/skills)");
  if (opts.dryRun) console.log("  Mode: DRY RUN (no files will be written)");
  console.log();

  // Step 1: Check prerequisites
  console.log("Step 1: Check prerequisites");
  const nodeVer = getVersion("node");
  if (!nodeVer) {
    console.error("  ✖  Node.js not found. Install from https://nodejs.org");
    process.exit(1);
  }
  log("✓", `Node.js ${nodeVer}`);

  if (!opts.skipBeads) {
    const bdPath = which("bd");
    if (!bdPath) {
      log("✖", "Beads (bd) not found on PATH");
      console.log("    Install: npm install -g @beads/bd");
      console.log("    Or download from: https://github.com/steveyegge/beads/releases");
      if (platform() === "win32") {
        console.log("    Windows: download bd.exe and place in a PATH directory");
      }
      process.exit(1);
    }
    log("✓", `Beads (bd) found: ${bdPath}`);

    const doltPath = which("dolt");
    if (!doltPath) {
      log("✖", "Dolt not found on PATH");
      console.log("    Install: https://docs.dolthub.com/introduction/installation");
      if (platform() === "win32") {
        console.log("    Windows: download dolt.exe and place in a PATH directory");
      }
      process.exit(1);
    }
    log("✓", `Dolt found: ${doltPath}`);
  }

  // Step 2: Initialize Beads
  console.log("\nStep 2: Initialize Beads");
  if (opts.skipBeads) {
    log("—", "Skipped (--skip-beads)");
  } else if (existsSync(beadsDir)) {
    log("—", ".beads/ already exists, skipping bd init");
  } else if (!opts.dryRun) {
    try {
      execFileSync("bd", ["init", "--server"], {
        cwd: projectRoot,
        encoding: "utf-8",
        timeout: 30_000,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      log("✓", "Beads initialized (bd init --server)");
    } catch (err: unknown) {
      const e = err as { stderr?: string };
      log("✖", `bd init failed: ${e.stderr ?? err}`);
      process.exit(1);
    }
  } else {
    log("📄", "Would run: bd init --server");
  }

  ensureGitignoreEntry(join(projectRoot, ".gitignore"), ".beads/", opts.dryRun);

  // Step 3: Generate MCP configs
  console.log("\nStep 3: Generate MCP configs");

  const cursorMcpEntry = (agentId: string) => ({
    command: "node",
    args: [serverEntry, "--agent-id", agentId, "--beads-dir", beadsDir, "--env", "cursor"],
    transport: "stdio",
  });

  const ccMcpEntry = (agentId: string) => ({
    command: "node",
    args: [serverEntry, "--agent-id", agentId, "--beads-dir", beadsDir],
    transport: "stdio",
  });


  // Project-level Cursor config
  mergeJsonFile(
    join(projectRoot, ".cursor", "mcp.json"),
    "agent-messenger",
    cursorMcpEntry(opts.cursorId),
    opts.dryRun
  );

  // Project-level CC config
  mergeJsonFile(
    join(projectRoot, ".mcp.json"),
    "agent-messenger",
    ccMcpEntry(opts.ccId),
    opts.dryRun
  );

  // Step 4: Copy Cursor rule
  console.log("\nStep 4: Install Cursor rule");
  const skippedFiles: string[] = [];
  const ruleResult = writeFileSafe(
    join(projectRoot, ".cursor", "rules", "agent-messenger.mdc"),
    CURSOR_RULE,
    opts.dryRun,
    opts.force
  );
  if (ruleResult === "skipped") skippedFiles.push("agent-messenger.mdc");

  // Step 5: Copy CC skills
  console.log("\nStep 5: Install Claude Code skills");
  for (const skill of SKILLS) {
    const needsInvocation = ["id", "cm", "sm", "ch", "wi"].includes(skill.name);
    const result = writeFileSafe(
      join(projectRoot, ".claude", "skills", skill.name, "SKILL.md"),
      skillContent(skill.name, skill.description, skill.body, !needsInvocation),
      opts.dryRun,
      opts.force
    );
    if (result === "skipped") skippedFiles.push(`skills/${skill.name}/SKILL.md`);
  }

  // Step 6: Validate
  console.log("\nStep 6: Validate");
  if (opts.dryRun) {
    log("—", "Skipped (dry run)");
  } else {
    try {
      const proc = execFileSync("node", [serverEntry, "--agent-id", "test", "--beads-dir", beadsDir], {
        encoding: "utf-8",
        timeout: 3_000,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const e = err as { stderr?: string; killed?: boolean };
      if (e.killed || e.stderr?.includes("MCP started")) {
        log("✓", "MCP server starts successfully");
      } else {
        log("⚠", `MCP server may have issues: ${e.stderr ?? ""}`);
      }
    }

    if (existsSync(beadsDir)) {
      try {
        execFileSync("bd", ["doctor"], {
          cwd: projectRoot,
          encoding: "utf-8",
          timeout: 15_000,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
        log("✓", "bd doctor passed");
      } catch {
        log("⚠", "bd doctor reported warnings (run 'bd doctor' for details)");
      }
    }
  }

  // Step 7: Next steps
  if (skippedFiles.length > 0) {
    console.log(`
  ⚠  ${skippedFiles.length} file(s) skipped — local customizations detected:
     ${skippedFiles.join(", ")}

     To overwrite with latest templates, re-run: agent-messenger init --force
     Your Beads data (.beads/) is never affected.
`);
  }

  console.log(`
Done! Next steps:

  1. Restart Cursor (or Ctrl+Shift+P → "Developer: Reload Window")
  2. Open a Claude Code terminal in this project
  3. Accept the agent-messenger MCP server when CC prompts
  4. In Cursor, type: #cm (check messages)
  5. In CC, type: check your inbox using the check_inbox tool
`);
}
