import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { platform } from "node:os";
import { MessageStore } from "../message-store.js";

interface LogMessage {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: number;
  issue_type: string;
  owner?: string;
  created_at: string;
  created_by?: string;
  updated_at: string;
  labels?: string[];
  dependencies?: { id: string; dependency_type: string; title: string }[];
  dependents?: { id: string; dependency_type: string; title: string }[];
}

interface LogOptions {
  beadsDir?: string;
  agent?: string;
  channel?: string;
  limit: number;
  thread?: string;
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

function bdList(beadsDir: string, extraArgs: string[] = []): LogMessage[] {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  env["BEADS_DIR"] = beadsDir;

  try {
    const raw = execFileSync("bd", ["list", "--type", "message", "--json", ...extraArgs], {
      encoding: "utf-8",
      timeout: 30_000,
      env,
      windowsHide: true,
    });
    return JSON.parse(raw) as LogMessage[];
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string };
    if (e.stderr?.includes("bad connection") || e.stderr?.includes("unreachable")) {
      console.error("Error: Dolt server not reachable. Run: bd dolt start");
    } else {
      console.error(`Error listing messages: ${e.stderr ?? e.stdout ?? "unknown"}`);
    }
    process.exit(1);
  }
}

function bdShow(beadsDir: string, id: string): LogMessage {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  env["BEADS_DIR"] = beadsDir;

  const raw = execFileSync("bd", ["show", id, "--json"], {
    encoding: "utf-8",
    timeout: 30_000,
    env,
    windowsHide: true,
  });
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function parseArgs(args: string[]): LogOptions {
  const opts: LogOptions = { limit: 20 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = args[i + 1];
    switch (arg) {
      case "--beads-dir":
        opts.beadsDir = next;
        i++;
        break;
      case "--agent":
      case "-a":
        opts.agent = next;
        i++;
        break;
      case "--channel":
      case "-c":
        opts.channel = next;
        i++;
        break;
      case "--limit":
      case "-n":
        opts.limit = parseInt(next ?? "20", 10);
        i++;
        break;
      case "--thread":
      case "-t":
        opts.thread = next;
        i++;
        break;
    }
  }
  return opts;
}

function extractLabel(labels: string[] | undefined, prefix: string): string | undefined {
  return labels?.find((l) => l.startsWith(prefix))?.slice(prefix.length);
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const isToday = d.toDateString() === now.toDateString();
  const isYesterday = new Date(now.getTime() - 86_400_000).toDateString() === d.toDateString();

  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `today ${time}`;
  if (isYesterday) return `yesterday ${time}`;
  if (diffMs < 7 * 86_400_000) {
    const day = d.toLocaleDateString([], { weekday: "short" });
    return `${day} ${time}`;
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`;
}

function truncate(str: string, maxLen: number): string {
  const oneLine = str.replace(/\n/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen - 1) + "…";
}

function printMessage(msg: LogMessage, indent = ""): void {
  const from = extractLabel(msg.labels, "from:") ?? "unknown";
  const to = extractLabel(msg.labels, "to:") ?? "unknown";
  const time = formatTimestamp(msg.created_at);
  const unread = msg.labels?.includes("unread") ? " *" : "";
  const channel = extractLabel(msg.labels, "channel:");
  const chTag = channel ? ` #${channel}` : "";
  const taskRef = extractLabel(msg.labels, "refs:");
  const refTag = taskRef ? ` [task:${taskRef}]` : "";
  const priority = msg.priority === 0 ? " [URGENT]" : "";

  console.log(`${indent}${from} -> ${to}  ${time}${unread}${priority}${chTag}${refTag}`);
  console.log(`${indent}  ${msg.title}  (${msg.id})`);
  if (msg.description) {
    console.log(`${indent}  ${truncate(msg.description, 100)}`);
  }
  console.log();
}

function collectThread(
  beadsDir: string,
  rootId: string,
  allMessages: Map<string, LogMessage>
): LogMessage[] {
  const result: LogMessage[] = [];
  const root = allMessages.get(rootId) ?? bdShow(beadsDir, rootId);
  result.push(root);

  const replies = root.dependents?.filter((d) => d.dependency_type === "replies_to") ?? [];
  for (const reply of replies) {
    const full = allMessages.get(reply.id) ?? bdShow(beadsDir, reply.id);
    result.push(...collectThread(beadsDir, full.id, allMessages));
  }

  result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return result;
}

function findRoot(beadsDir: string, msgId: string): string {
  const msg = bdShow(beadsDir, msgId);
  const parent = msg.dependencies?.find((d) => d.dependency_type === "replies_to");
  if (parent) return findRoot(beadsDir, parent.id);
  return msg.id;
}

export async function log(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  const projectRoot = findProjectRoot();
  const beadsDir = opts.beadsDir ?? join(projectRoot, ".beads");

  if (!which("bd")) {
    console.error("Error: bd not found on PATH. Install Beads first.");
    process.exit(1);
  }

  if (!existsSync(beadsDir)) {
    console.error(`Error: .beads/ not found at ${beadsDir}`);
    console.error("Run: agent-messenger init");
    process.exit(1);
  }

  // Fast path: read from .am/ file store if available
  const amDir = join(projectRoot, ".am");
  if (existsSync(amDir) && !opts.thread) {
    const store = new MessageStore(amDir);
    const results = store.query({
      from: opts.agent,
      channel: opts.channel,
      limit: opts.limit,
    });

    if (results.length === 0) {
      console.log("\nNo messages found.\n");
      return;
    }

    const filters: string[] = [];
    if (opts.agent) filters.push(`agent: ${opts.agent}`);
    if (opts.channel) filters.push(`channel: ${opts.channel}`);
    const filterStr = filters.length > 0 ? ` (${filters.join(", ")})` : "";
    console.log(`\nagent-messenger log${filterStr} — ${results.length} messages`);
    console.log("=".repeat(60));

    for (const meta of results) {
      const time = formatTimestamp(meta.timestamp);
      const unread = meta.unread ? " *" : "";
      const chTag = meta.channel ? ` #${meta.channel}` : "";
      const refTag = meta.task_id ? ` [task:${meta.task_id}]` : "";
      const priority = meta.priority === "urgent" ? " [URGENT]" : "";

      console.log(`${meta.from} -> ${meta.to}  ${time}${unread}${priority}${chTag}${refTag}`);
      console.log(`  ${meta.subject}  (${meta.id})`);
      console.log();
    }
    return;
  }

  // Thread view: show a single conversation tree (falls back to Beads for old messages)
  if (opts.thread) {
    const rootId = findRoot(beadsDir, opts.thread);
    const allMsgs = bdList(beadsDir);
    const index = new Map(allMsgs.map((m) => [m.id, m]));
    const thread = collectThread(beadsDir, rootId, index);

    const subject = thread[0]?.title.replace(/^Re: /, "") ?? "Unknown";
    console.log(`\nThread: ${subject}`);
    console.log("=".repeat(60));
    for (const msg of thread) {
      const isReply = msg.dependencies?.some((d) => d.dependency_type === "replies_to");
      printMessage(msg, isReply ? "  " : "");
    }
    return;
  }

  // Build label filter
  const labelParts: string[] = [];
  if (opts.agent) {
    labelParts.push(`from:${opts.agent}`);
  }
  if (opts.channel) {
    labelParts.push(`channel:${opts.channel}`);
  }
  const extraArgs = labelParts.length > 0 ? ["--label", labelParts.join(",")] : [];

  const messages = bdList(beadsDir, extraArgs);

  if (messages.length === 0) {
    console.log("\nNo messages found.\n");
    return;
  }

  const sorted = messages
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-opts.limit);

  const filters: string[] = [];
  if (opts.agent) filters.push(`agent: ${opts.agent}`);
  if (opts.channel) filters.push(`channel: ${opts.channel}`);
  const filterStr = filters.length > 0 ? ` (${filters.join(", ")})` : "";

  console.log(`\nagent-messenger log${filterStr} — ${sorted.length} of ${messages.length} messages`);
  console.log("=".repeat(60));

  for (const msg of sorted) {
    printMessage(msg);
  }
}
