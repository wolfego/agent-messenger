import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { platform } from "node:os";
import { MessageStore } from "../message-store.js";

interface StatusMessage {
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
}

interface AgentStats {
  unread: number;
  total: number;
  latestMessage?: StatusMessage;
  channels: Set<string>;
}

function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

function parseArgs(args: string[]): { beadsDir?: string } {
  let beadsDir: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--beads-dir" && args[i + 1]) {
      beadsDir = args[i + 1]!;
      i++;
    }
  }
  return { beadsDir };
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

function bdList(beadsDir: string): StatusMessage[] {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  env["BEADS_DIR"] = beadsDir;

  try {
    const raw = execFileSync("bd", ["list", "--type", "message", "--json"], {
      encoding: "utf-8",
      timeout: 30_000,
      env,
      windowsHide: true,
    });
    return JSON.parse(raw) as StatusMessage[];
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

function extractLabel(labels: string[] | undefined, prefix: string): string | undefined {
  return labels?.find((l) => l.startsWith(prefix))?.slice(prefix.length);
}

function extractLabels(labels: string[] | undefined, prefix: string): string[] {
  return (labels ?? [])
    .filter((l) => l.startsWith(prefix))
    .map((l) => l.slice(prefix.length));
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

export async function status(args: string[]): Promise<void> {
  const { beadsDir: explicitBeadsDir } = parseArgs(args);
  const projectRoot = findProjectRoot();
  const beadsDir = explicitBeadsDir ?? join(projectRoot, ".beads");

  if (!which("bd")) {
    console.error("Error: bd not found on PATH. Install Beads first.");
    process.exit(1);
  }

  if (!existsSync(beadsDir)) {
    console.error(`Error: .beads/ not found at ${beadsDir}`);
    console.error("Run: agent-messenger init");
    process.exit(1);
  }

  const amDir = join(projectRoot, ".am");
  let messages: StatusMessage[];

  if (existsSync(amDir)) {
    const store = new MessageStore(amDir);
    const index = store.query({});
    messages = index.map((m) => ({
      id: m.id,
      title: m.subject,
      description: undefined,
      status: m.unread ? "open" : "closed",
      priority: m.priority === "urgent" ? 0 : 2,
      issue_type: "message",
      created_at: m.timestamp,
      updated_at: m.timestamp,
      labels: [
        `to:${m.to}`,
        `from:${m.from}`,
        ...(m.unread ? ["unread"] : []),
        ...(m.channel ? [`channel:${m.channel}`] : []),
        ...(m.action ? [`action:${m.action}`] : []),
      ],
    }));
  } else {
    messages = bdList(beadsDir);
  }

  if (messages.length === 0) {
    console.log("\nagent-messenger status");
    console.log("  No messages yet.\n");
    return;
  }

  // Build per-agent stats (keyed by the "to" agent)
  const agentMap = new Map<string, AgentStats>();
  const allChannels = new Set<string>();
  const recentAgents = new Map<string, string>(); // agentId -> last seen timestamp

  for (const msg of messages) {
    const to = extractLabel(msg.labels, "to:");
    const from = extractLabel(msg.labels, "from:");
    const isUnread = msg.labels?.includes("unread") ?? false;
    const channels = extractLabels(msg.labels, "channel:");

    for (const ch of channels) allChannels.add(ch);

    // Track agent activity (both sender and receiver)
    if (from) {
      const existing = recentAgents.get(from);
      if (!existing || msg.created_at > existing) {
        recentAgents.set(from, msg.created_at);
      }
    }

    if (!to) continue;

    let stats = agentMap.get(to);
    if (!stats) {
      stats = { unread: 0, total: 0, channels: new Set() };
      agentMap.set(to, stats);
    }

    stats.total++;
    if (isUnread) stats.unread++;
    for (const ch of channels) stats.channels.add(ch);

    if (!stats.latestMessage || msg.created_at > stats.latestMessage.created_at) {
      stats.latestMessage = msg;
    }
  }

  // Output
  console.log("\nagent-messenger status");
  console.log(`  Project: ${projectRoot}`);
  console.log(`  Messages: ${messages.length} total\n`);

  // Unread summary
  const withUnread = [...agentMap.entries()]
    .filter(([, s]) => s.unread > 0)
    .sort((a, b) => b[1].unread - a[1].unread);

  if (withUnread.length > 0) {
    console.log("UNREAD");
    for (const [agent, stats] of withUnread) {
      const latest = stats.latestMessage;
      const from = latest ? extractLabel(latest.labels, "from:") : undefined;
      const time = latest ? relativeTime(latest.created_at) : "";
      const subject = latest ? truncate(latest.title, 50) : "";
      console.log(`  ${stats.unread} unread → ${agent}`);
      if (latest) {
        console.log(`    Latest: "${subject}" from ${from ?? "unknown"} (${time})`);
      }
    }
    console.log();
  } else {
    console.log("  No unread messages.\n");
  }

  // Recent messages (last 5 across all agents)
  const sorted = [...messages]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  console.log("RECENT MESSAGES");
  for (const msg of sorted) {
    const from = extractLabel(msg.labels, "from:") ?? "unknown";
    const to = extractLabel(msg.labels, "to:") ?? "unknown";
    const time = relativeTime(msg.created_at);
    const unread = msg.labels?.includes("unread") ? " [unread]" : "";
    const channel = extractLabel(msg.labels, "channel:");
    const chLabel = channel ? ` #${channel}` : "";
    console.log(`  ${from} → ${to}: "${truncate(msg.title, 45)}"${unread}${chLabel}  ${time}`);
  }
  console.log();

  // Active agents
  if (recentAgents.size > 0) {
    console.log("AGENTS");
    const sortedAgents = [...recentAgents.entries()]
      .sort((a, b) => b[1].localeCompare(a[1]));

    for (const [agentId, lastSeen] of sortedAgents) {
      const stats = agentMap.get(agentId);
      const channelInfo = stats && stats.channels.size > 0
        ? ` (channels: ${[...stats.channels].join(", ")})`
        : "";
      console.log(`  ${agentId}  last active ${relativeTime(lastSeen)}${channelInfo}`);
    }
    console.log();
  }

  // Channels
  if (allChannels.size > 0) {
    console.log("CHANNELS");
    for (const ch of allChannels) {
      const agentsOnChannel = [...agentMap.entries()]
        .filter(([, s]) => s.channels.has(ch))
        .map(([id]) => id);
      console.log(`  #${ch}  (${agentsOnChannel.join(", ")})`);
    }
    console.log();
  }
}
