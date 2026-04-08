import { execFileSync } from "node:child_process";
import type { Config } from "./config.js";

export interface BeadsMessage {
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
  ephemeral?: boolean;
  labels?: string[];
  dependencies?: BeadsDep[];
  dependents?: BeadsDep[];
  dependency_count?: number;
  dependent_count?: number;
}

export interface BeadsDep {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: number;
  issue_type: string;
  created_at: string;
  created_by?: string;
  updated_at: string;
  labels?: string[];
  ephemeral?: boolean;
  dependency_type: string;
}

function bdExec(config: Config, args: string[]): string {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (config.beadsDir) {
    env["BEADS_DIR"] = config.beadsDir;
  }

  try {
    const result = execFileSync("bd", args, {
      encoding: "utf-8",
      timeout: 30_000,
      env,
      windowsHide: true,
    });
    return result;
  } catch (err: unknown) {
    const execErr = err as { stderr?: string; stdout?: string; message?: string };
    const stderr = execErr.stderr ?? "";
    const stdout = execErr.stdout ?? "";
    throw new Error(
      `bd ${args.join(" ")} failed: ${stderr || stdout || execErr.message}`
    );
  }
}

function bdJson<T>(config: Config, args: string[]): T {
  const raw = bdExec(config, [...args, "--json"]);
  return JSON.parse(raw) as T;
}

function channelLabel(config: Config): string | undefined {
  return config.channel ? `channel:${config.channel}` : undefined;
}

export function createMessage(
  config: Config,
  params: {
    to: string;
    subject: string;
    body: string;
    contextFiles?: string[];
    action?: string;
    priority?: "normal" | "urgent";
  }
): BeadsMessage {
  const labels = [`to:${params.to}`, `from:${config.agentId}`, "unread"];
  if (params.action) labels.push(`action:${params.action}`);
  const ch = channelLabel(config);
  if (ch) labels.push(ch);

  let body = params.body;
  if (params.contextFiles?.length) {
    body += "\n\n---\nContext files:\n" + params.contextFiles.map((f) => `- ${f}`).join("\n");
  }

  const args = [
    "create",
    params.subject,
    "--type", "message",
    "--description", body,
    "--labels", labels.join(","),
    "--priority", params.priority === "urgent" ? "0" : "2",
  ];

  return bdJson<BeadsMessage>(config, args);
}

export function checkInbox(
  config: Config,
  includeRead = false
): BeadsMessage[] {
  const ch = channelLabel(config);

  // Fetch messages addressed to either the base ID or the full session ID
  const targets = new Set([config.baseId, config.agentId]);
  const allMessages: BeadsMessage[] = [];

  for (const target of targets) {
    const labelParts = [`to:${target}`];
    if (!includeRead) labelParts.push("unread");
    if (ch) labelParts.push(ch);

    const args = [
      "list",
      "--type", "message",
      "--label", labelParts.join(","),
      "--status", "open",
    ];
    const msgs = bdJson<BeadsMessage[]>(config, args);
    allMessages.push(...msgs);
  }

  // Deduplicate by ID (in case baseId === agentId with --no-auto-id)
  const seen = new Set<string>();
  return allMessages.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

export function replyToMessage(
  config: Config,
  params: { messageId: string; body: string; contextFiles?: string[] }
): BeadsMessage {
  const original = showMessage(config, params.messageId);
  const originalFrom = original.labels?.find((l) => l.startsWith("from:"))?.slice(5) ?? "unknown";
  const subject = original.title.startsWith("Re: ") ? original.title : `Re: ${original.title}`;

  let body = params.body;
  if (params.contextFiles?.length) {
    body += "\n\n---\nContext files:\n" + params.contextFiles.map((f) => `- ${f}`).join("\n");
  }

  const labels = [`to:${originalFrom}`, `from:${config.agentId}`, "unread"];
  const originalChannel = original.labels?.find((l) => l.startsWith("channel:"));
  if (originalChannel) labels.push(originalChannel);

  const args = [
    "create",
    subject,
    "--type", "message",
    "--description", body,
    "--labels", labels.join(","),
    "--deps", `replies_to:${params.messageId}`,
    "--priority", String(original.priority),
  ];

  return bdJson<BeadsMessage>(config, args);
}

export function showMessage(config: Config, messageId: string): BeadsMessage {
  const result = bdJson<BeadsMessage[]>(config, ["show", messageId]);
  if (Array.isArray(result) && result.length > 0) {
    return result[0]!;
  }
  return result as unknown as BeadsMessage;
}

export function markRead(config: Config, messageId: string): void {
  bdJson(config, ["label", "remove", messageId, "unread"]);
}

export function getThread(
  config: Config,
  messageId: string
): BeadsMessage[] {
  const root = findThreadRoot(config, messageId);
  return collectThread(config, root);
}

function findThreadRoot(config: Config, messageId: string): BeadsMessage {
  const msg = showMessage(config, messageId);
  const parentLink = msg.dependencies?.find((d) => d.dependency_type === "replies_to");
  if (parentLink) {
    return findThreadRoot(config, parentLink.id);
  }
  return msg;
}

function collectThread(config: Config, root: BeadsMessage): BeadsMessage[] {
  const messages: BeadsMessage[] = [root];
  const replies = root.dependents?.filter((d) => d.dependency_type === "replies_to") ?? [];
  for (const reply of replies) {
    const full = showMessage(config, reply.id);
    messages.push(...collectThread(config, full));
  }
  messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return messages;
}

export interface Conversation {
  threadId: string;
  subject: string;
  lastMessage: BeadsMessage;
  unreadCount: number;
  messageCount: number;
}

export function listConversations(
  config: Config,
  status: "open" | "closed" | "all" = "all"
): Conversation[] {
  const labelParts = [`to:${config.agentId}`];
  const ch = channelLabel(config);
  if (ch) labelParts.push(ch);

  const args = ["list", "--type", "message", "--label", labelParts.join(",")];
  if (status !== "all") {
    args.push("--status", status);
  }
  const messages = bdJson<BeadsMessage[]>(config, args);

  const threads = new Map<string, BeadsMessage[]>();
  for (const msg of messages) {
    const rootId = findRootId(config, msg);
    const existing = threads.get(rootId) ?? [];
    existing.push(msg);
    threads.set(rootId, existing);
  }

  const conversations: Conversation[] = [];
  for (const [threadId, msgs] of threads) {
    msgs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const last = msgs[msgs.length - 1]!;
    const unreadCount = msgs.filter((m) => m.labels?.includes("unread")).length;
    const root = msgs[0]!;
    conversations.push({
      threadId,
      subject: root.title.replace(/^Re: /, ""),
      lastMessage: last,
      unreadCount,
      messageCount: msgs.length,
    });
  }

  return conversations;
}

function findRootId(config: Config, msg: BeadsMessage): string {
  if (!msg.dependencies?.length) return msg.id;
  const parent = msg.dependencies.find((d) => d.dependency_type === "replies_to");
  if (!parent) return msg.id;
  try {
    const parentMsg = showMessage(config, parent.id);
    return findRootId(config, parentMsg);
  } catch {
    return msg.id;
  }
}

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

export interface AgentPresence {
  agent_id: string;
  base_id: string;
  channel: string | null;
  last_seen: string;
  stale: boolean;
}

const PRESENCE_STALENESS_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Remove presence records from previous sessions sharing our baseId.
 * Called on startup before registering the current session.
 */
export function cleanStalePresence(config: Config): void {
  try {
    const all = bdJson<BeadsMessage[]>(config, [
      "list", "--type", "chore", "--label", `kind:presence,base:${config.baseId}`,
    ]);
    for (const rec of all) {
      const recAgent = rec.labels?.find((l) => l.startsWith("agent:"))?.slice(6);
      if (recAgent && recAgent !== config.agentId) {
        try {
          bdExec(config, ["close", rec.id, "--reason", "stale session replaced"]);
        } catch { /* best-effort */ }
      }
    }
  } catch { /* ignore — list may return nothing */ }
}

/**
 * Write a presence record for this agent session.
 * If one already exists for this agentId, update it; otherwise create.
 */
export function registerPresence(config: Config): void {
  const labels = [`kind:presence`, `agent:${config.agentId}`, `base:${config.baseId}`];
  if (config.channel) labels.push(`channel:${config.channel}`);

  try {
    const existing = bdJson<BeadsMessage[]>(config, [
      "list", "--type", "chore", "--label", `kind:presence,agent:${config.agentId}`, "--status", "open",
    ]);

    if (existing.length > 0) {
      bdExec(config, [
        "update", existing[0]!.id,
        "--append-notes", `heartbeat ${new Date().toISOString()}`,
      ]);
      return;
    }
  } catch { /* fall through to create */ }

  bdExec(config, [
    "create", `${config.agentId} online`,
    "--type", "chore",
    "--labels", labels.join(","),
    "--priority", "4",
    "--description", `Agent ${config.agentId} (base: ${config.baseId}) started at ${new Date().toISOString()}`,
  ]);
}

/**
 * List all agents with open presence records.
 * Marks agents as stale if their record hasn't been updated within the staleness window.
 */
export function listAgents(config: Config): AgentPresence[] {
  const all = bdJson<BeadsMessage[]>(config, [
    "list", "--type", "chore", "--label", "kind:presence", "--status", "open",
  ]);

  const now = Date.now();
  return all.map((rec) => {
    const agentId = rec.labels?.find((l) => l.startsWith("agent:"))?.slice(6) ?? rec.title;
    const baseId = rec.labels?.find((l) => l.startsWith("base:"))?.slice(5) ?? "unknown";
    const channel = rec.labels?.find((l) => l.startsWith("channel:"))?.slice(8) ?? null;
    const lastSeen = rec.updated_at;
    const stale = now - new Date(lastSeen).getTime() > PRESENCE_STALENESS_MS;

    return { agent_id: agentId, base_id: baseId, channel, last_seen: lastSeen, stale };
  });
}
