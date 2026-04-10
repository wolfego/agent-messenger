import { execFileSync } from "node:child_process";
import type { Config } from "./config.js";

export interface BeadsTask {
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
  dependencies?: BeadsTaskDep[];
  dependents?: BeadsTaskDep[];
  dependency_count?: number;
  dependent_count?: number;
  estimate?: number;
  due_at?: string;
  notes?: string;
  acceptance?: string;
  design?: string;
}

export interface BeadsTaskDep {
  id: string;
  title: string;
  status: string;
  priority: number;
  issue_type: string;
  dependency_type: string;
}

function bdExec(config: Config, args: string[]): string {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (config.beadsDir) {
    env["BEADS_DIR"] = config.beadsDir;
  }

  try {
    return execFileSync("bd", args, {
      encoding: "utf-8",
      timeout: 30_000,
      env,
      windowsHide: true,
    });
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    throw new Error(`bd ${args.join(" ")} failed: ${e.stderr || e.stdout || e.message}`);
  }
}

function bdJson<T>(config: Config, args: string[]): T {
  const raw = bdExec(config, [...args, "--json"]);
  return JSON.parse(raw) as T;
}

export function createTask(
  config: Config,
  params: {
    title: string;
    description?: string;
    type?: string;
    priority?: string;
    labels?: string[];
    parent?: string;
    deps?: string[];
    assignee?: string;
    due?: string;
    estimate?: number;
    context?: string;
    design_file?: string;
  }
): BeadsTask {
  const args = ["create", params.title, "--type", params.type ?? "task"];

  if (params.description) args.push("--description", params.description);
  if (params.priority) args.push("--priority", params.priority);
  if (params.labels?.length) args.push("--labels", params.labels.join(","));
  if (params.parent) args.push("--parent", params.parent);
  if (params.deps?.length) args.push("--deps", params.deps.join(","));
  if (params.assignee) args.push("--assignee", params.assignee);
  if (params.due) args.push("--due", params.due);
  if (params.estimate) args.push("--estimate", String(params.estimate));
  if (params.context) args.push("--context", params.context);
  if (params.design_file) args.push("--design-file", params.design_file);

  return bdJson<BeadsTask>(config, args);
}

export function listTasks(
  config: Config,
  params: {
    status?: string;
    assignee?: string;
    priority?: string;
    label?: string;
    parent?: string;
    ready_only?: boolean;
    type?: string;
    limit?: number;
    sort?: string;
  }
): BeadsTask[] {
  const args = ["list"];
  const type = params.type ?? "task";
  args.push("--type", type);

  if (params.status) args.push("--status", params.status);
  if (params.assignee) args.push("--assignee", params.assignee);
  if (params.priority) args.push("--priority", params.priority);
  if (params.label) args.push("--label", params.label);
  if (params.parent) args.push("--parent", params.parent);
  if (params.ready_only) args.push("--ready");
  if (params.limit) args.push("--limit", String(params.limit));
  if (params.sort) args.push("--sort", params.sort);

  return bdJson<BeadsTask[]>(config, args);
}

export function showTask(
  config: Config,
  params: { task_id: string; long?: boolean; children?: boolean }
): BeadsTask | BeadsTask[] {
  const args = ["show", params.task_id];
  if (params.long) args.push("--long");
  if (params.children) args.push("--children");

  return bdJson<BeadsTask | BeadsTask[]>(config, args);
}

export function updateTask(
  config: Config,
  params: {
    task_id: string;
    status?: string;
    title?: string;
    description?: string;
    notes?: string;
    priority?: string;
    assignee?: string;
    add_labels?: string[];
    remove_labels?: string[];
    due?: string;
    estimate?: number;
  }
): BeadsTask {
  const args = ["update", params.task_id];

  if (params.status) args.push("--status", params.status);
  if (params.title) args.push("--title", params.title);
  if (params.description) args.push("--description", params.description);
  if (params.notes) args.push("--append-notes", params.notes);
  if (params.priority) args.push("--priority", params.priority);
  if (params.assignee) args.push("--assignee", params.assignee);
  if (params.add_labels?.length) {
    for (const l of params.add_labels) args.push("--add-label", l);
  }
  if (params.remove_labels?.length) {
    for (const l of params.remove_labels) args.push("--remove-label", l);
  }
  if (params.due) args.push("--due", params.due);
  if (params.estimate) args.push("--estimate", String(params.estimate));

  return bdJson<BeadsTask>(config, args);
}

export function claimTask(config: Config, taskId: string): BeadsTask {
  return bdJson<BeadsTask>(config, ["update", taskId, "--claim"]);
}

export function closeTask(
  config: Config,
  params: { task_id: string; reason?: string; suggest_next?: boolean }
): BeadsTask {
  const args = ["close", params.task_id];
  if (params.reason) args.push("--reason", params.reason);
  if (params.suggest_next) args.push("--suggest-next");

  return bdJson<BeadsTask>(config, args);
}

export function reopenTask(
  config: Config,
  params: { task_id: string; reason?: string }
): BeadsTask {
  const args = ["reopen", params.task_id];
  if (params.reason) args.push("--reason", params.reason);

  return bdJson<BeadsTask>(config, args);
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface DepRecord {
  from_id: string;
  to_id: string;
  dependency_type: string;
  from_title?: string;
  to_title?: string;
  from_status?: string;
  to_status?: string;
}

export function addDep(
  config: Config,
  params: { issue_id: string; depends_on: string; type?: string }
): string {
  const args = ["dep", "add", params.issue_id, params.depends_on];
  if (params.type) args.push("--type", params.type);
  return bdExec(config, args);
}

export function removeDep(
  config: Config,
  params: { issue_id: string; depends_on: string }
): string {
  return bdExec(config, ["dep", "remove", params.issue_id, params.depends_on]);
}

export function listDeps(
  config: Config,
  params: { issue_id: string; direction?: "up" | "down"; type?: string }
): DepRecord[] {
  const args = ["dep", "list", params.issue_id];
  if (params.direction) args.push("--direction", params.direction);
  if (params.type) args.push("--type", params.type);
  return bdJson<DepRecord[]>(config, args);
}

// ---------------------------------------------------------------------------
// Blocked tasks
// ---------------------------------------------------------------------------

export function blockedTasks(
  config: Config,
  params: { parent?: string }
): BeadsTask[] {
  const args = ["blocked"];
  if (params.parent) args.push("--parent", params.parent);
  return bdJson<BeadsTask[]>(config, args);
}

// ---------------------------------------------------------------------------
// Project stats
// ---------------------------------------------------------------------------

export function projectStats(
  config: Config,
  params: { assigned_only?: boolean; include_activity?: boolean }
): unknown {
  const args = ["status"];
  if (params.assigned_only) args.push("--assigned");
  if (params.include_activity === false) args.push("--no-activity");
  return bdJson<unknown>(config, args);
}
