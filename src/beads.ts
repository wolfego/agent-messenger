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

export function queryBeads(
  config: Config,
  params: {
    type: string;
    labels?: string[];
    status?: string;
    limit?: number;
    sort?: string;
    reverse?: boolean;
  }
): BeadsMessage[] {
  const args = ["list", "--type", params.type, "--include-infra"];

  if (params.labels && params.labels.length > 0) {
    args.push("--label", params.labels.join(","));
  }
  if (params.status && params.status !== "all") {
    args.push("--status", params.status);
  } else if (params.status === "all") {
    args.push("--all");
  }
  if (params.limit) {
    args.push("--limit", String(params.limit));
  }
  if (params.sort) {
    args.push("--sort", params.sort);
  }
  if (params.reverse) {
    args.push("--reverse");
  }
  args.push("--flat");

  return bdJson<BeadsMessage[]>(config, args);
}

// ---------------------------------------------------------------------------
// Workflow Checkpoints
// ---------------------------------------------------------------------------

export function createWorkflowCheckpoint(
  config: Config,
  params: {
    workflow: string;
    feature: string;
    phase: string;
    status: "started" | "completed";
  }
): BeadsMessage {
  const title = `${params.workflow}: ${params.feature} — ${params.phase} ${params.status}`;
  const labels = [
    "kind:workflow-checkpoint",
    `workflow:${params.workflow}`,
    `feature:${params.feature}`,
    `phase:${params.phase}`,
    `status:${params.status}`,
  ];

  return bdJson<BeadsMessage>(config, [
    "create", title,
    "--type", "chore",
    "--ephemeral",
    "--labels", labels.join(","),
    "--priority", "4",
    "--no-history",
  ]);
}

export interface WorkflowCheckpoint {
  id: string;
  workflow: string;
  feature: string;
  phase: string;
  status: string;
  timestamp: string;
}

export function queryWorkflowCheckpoints(
  config: Config,
  params: { workflow?: string; feature?: string }
): WorkflowCheckpoint[] {
  const labelParts = ["kind:workflow-checkpoint"];
  if (params.workflow) labelParts.push(`workflow:${params.workflow}`);
  if (params.feature) labelParts.push(`feature:${params.feature}`);

  const raw = bdJson<BeadsMessage[]>(config, [
    "list", "--type", "chore",
    "--label", labelParts.join(","),
    "--include-infra",
    "--flat",
    "--sort", "created",
    "--reverse",
    "--limit", "50",
  ]);

  return raw.map((r) => ({
    id: r.id,
    workflow: r.labels?.find((l) => l.startsWith("workflow:"))?.slice(9) ?? "unknown",
    feature: r.labels?.find((l) => l.startsWith("feature:"))?.slice(8) ?? "unknown",
    phase: r.labels?.find((l) => l.startsWith("phase:"))?.slice(6) ?? "unknown",
    status: r.labels?.find((l) => l.startsWith("status:"))?.slice(7) ?? "unknown",
    timestamp: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Task-Message Linking
// ---------------------------------------------------------------------------

export function listLinkedMessages(config: Config, taskId: string): BeadsMessage[] {
  try {
    return bdJson<BeadsMessage[]>(config, [
      "list", "--type", "message", "--label", `refs:${taskId}`,
    ]);
  } catch {
    return [];
  }
}

export function appendTaskNote(config: Config, taskId: string, note: string): void {
  bdExec(config, ["update", taskId, "--append-notes", note]);
}

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

export interface AgentPresence {
  agent_id: string;
  base_id: string;
  env: string | null;
  channel: string | null;
  registered_at: string;
  last_seen: string;
  stale: boolean;
}

let presenceRecordId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function isStale(record: BeadsMessage): boolean {
  const updatedAt = new Date(record.updated_at).getTime();
  return Date.now() - updatedAt > STALE_THRESHOLD_MS;
}

/**
 * Close ALL stale presence records (any base ID) that haven't been
 * updated within the threshold. Called on startup.
 */
export function cleanStalePresence(config: Config): void {
  try {
    const all = bdJson<BeadsMessage[]>(config, [
      "list", "--type", "chore", "--label", "kind:presence", "--status", "open",
    ]);
    for (const rec of all) {
      if (isStale(rec)) {
        try {
          bdExec(config, ["close", rec.id, "--reason", "stale — no heartbeat"]);
        } catch { /* best-effort */ }
      }
    }
  } catch { /* ignore */ }
}

/**
 * Write a presence record for this agent session.
 * If one already exists for this agentId, update it; otherwise create.
 * Starts a periodic heartbeat to keep the record fresh.
 */
export function registerPresence(config: Config): void {
  const labels = [`kind:presence`, `agent:${config.agentId}`, `base:${config.baseId}`, `env:${config.env}`];
  if (config.channel) labels.push(`channel:${config.channel}`);

  try {
    const existing = bdJson<BeadsMessage[]>(config, [
      "list", "--type", "chore", "--label", `kind:presence,agent:${config.agentId}`, "--status", "open",
    ]);

    if (existing.length > 0) {
      presenceRecordId = existing[0]!.id;
      bdExec(config, [
        "update", presenceRecordId,
        "--append-notes", `heartbeat ${new Date().toISOString()}`,
      ]);
      startHeartbeat(config);
      return;
    }
  } catch { /* fall through to create */ }

  const result = bdJson<BeadsMessage>(config, [
    "create", `${config.agentId} online`,
    "--type", "chore",
    "--labels", labels.join(","),
    "--priority", "4",
    "--description", `Agent ${config.agentId} (base: ${config.baseId}) started at ${new Date().toISOString()}`,
  ]);
  presenceRecordId = result.id;
  startHeartbeat(config);
}

function startHeartbeat(config: Config): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (!presenceRecordId) return;
    try {
      bdExec(config, [
        "update", presenceRecordId,
        "--append-notes", `heartbeat ${new Date().toISOString()}`,
      ]);
    } catch { /* best-effort */ }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();
}

/**
 * Close our presence record and stop heartbeat. Called on process exit.
 */
export function deregisterPresence(config: Config): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (!presenceRecordId) return;
  try {
    bdExec(config, ["close", presenceRecordId, "--reason", "session ended"]);
  } catch { /* best-effort on exit */ }
  presenceRecordId = null;
}

/**
 * List agents with open presence records, excluding stale ones.
 */
export function listAgents(config: Config): AgentPresence[] {
  const all = bdJson<BeadsMessage[]>(config, [
    "list", "--type", "chore", "--label", "kind:presence", "--status", "open",
  ]);

  return all
    .filter((rec) => !isStale(rec))
    .map((rec) => {
      const agentId = rec.labels?.find((l) => l.startsWith("agent:"))?.slice(6) ?? rec.title;
      const baseId = rec.labels?.find((l) => l.startsWith("base:"))?.slice(5) ?? "unknown";
      const envLabel = rec.labels?.find((l) => l.startsWith("env:"))?.slice(4) ?? null;
      const channel = rec.labels?.find((l) => l.startsWith("channel:"))?.slice(8) ?? null;

      return {
        agent_id: agentId,
        base_id: baseId,
        env: envLabel,
        channel,
        registered_at: rec.created_at,
        last_seen: rec.updated_at,
        stale: false,
      };
    });
}
