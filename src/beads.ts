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
  const labelParts = [`to:${config.agentId}`];
  if (!includeRead) labelParts.push("unread");
  const ch = channelLabel(config);
  if (ch) labelParts.push(ch);

  const args = [
    "list",
    "--type", "message",
    "--label", labelParts.join(","),
    "--status", "open",
  ];
  return bdJson<BeadsMessage[]>(config, args);
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
