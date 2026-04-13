/**
 * Beads-backed persistence for workflow runs and stages.
 *
 * Each run is stored as a Beads chore with:
 *   - label `kind:workflow-run`
 *   - label `run:<runId>`
 *   - JSON-serialised RunRecord in the description field
 *
 * Each stage is stored as a Beads chore with:
 *   - label `kind:workflow-stage`
 *   - label `run:<runId>`
 *   - label `stage:<stageId>`
 *   - JSON-serialised StageRecord in the description field
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import type {
  RunRecord,
  StageRecord,
  RunId,
  StageId,
  RunStatus,
  OnTimeoutAction,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface BeadsChore {
  id: string;
  title: string;
  description?: string;
  labels?: string[];
}

/**
 * Execute a `bd` CLI command with array args (no shell interpolation).
 *
 * @param beadsDir - Absolute path to the .beads directory
 * @param args - CLI argument array passed directly to execFileSync
 * @returns stdout as a string
 */
function bdExec(beadsDir: string, args: string[]): string {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    BEADS_DIR: beadsDir,
  };
  try {
    return execFileSync("bd", args, {
      encoding: "utf-8",
      timeout: 30_000,
      env,
      windowsHide: true,
    });
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const detail = e.stderr ?? e.stdout ?? e.message ?? String(err);
    throw new Error(`bd ${args.join(" ")} failed: ${detail}`);
  }
}

/**
 * Execute a `bd` command and parse the output as JSON.
 */
function bdJson<T>(beadsDir: string, args: string[]): T {
  const raw = bdExec(beadsDir, [...args, "--json"]);
  return JSON.parse(raw) as T;
}

function generateRunId(): RunId {
  return `run-${randomBytes(4).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// WorkflowPersistence
// ---------------------------------------------------------------------------

export class WorkflowPersistence {
  constructor(private readonly beadsDir: string) {}

  // -------------------------------------------------------------------------
  // Run operations
  // -------------------------------------------------------------------------

  /**
   * Create a new workflow run record in Beads.
   *
   * @param params.templateName - Name of the workflow template
   * @param params.description - Human-readable description
   * @param params.createdBy - Agent ID that initiated the run
   * @returns The newly created RunRecord
   */
  createRun(params: {
    templateName: string;
    description: string;
    createdBy: string;
  }): RunRecord {
    const runId = generateRunId();
    const now = new Date().toISOString();

    const record: RunRecord = {
      runId,
      templateName: params.templateName,
      description: params.description,
      status: "pending",
      createdBy: params.createdBy,
      startedAt: now,
      finishedAt: null,
      currentStageIds: [],
      error: null,
    };

    const labels = [
      "kind:workflow-run",
      `run:${runId}`,
      `template:${params.templateName}`,
      `wf-status:${record.status}`,
    ];

    bdJson<BeadsChore>(this.beadsDir, [
      "create",
      `workflow-run: ${params.templateName}`,
      "--type", "chore",
      "--description", JSON.stringify(record),
      "--labels", labels.join(","),
      "--priority", "3",
    ]);

    return record;
  }

  /**
   * Retrieve a run by its runId.
   *
   * @param runId - The run identifier (e.g. "run-a1b2c3d4")
   * @returns The RunRecord or null if not found
   */
  getRun(runId: RunId): RunRecord | null {
    try {
      const results = bdJson<BeadsChore[]>(this.beadsDir, [
        "list",
        "--type", "chore",
        "--label", `kind:workflow-run,run:${runId}`,
        "--include-infra",
        "--flat",
      ]);
      if (results.length === 0) return null;
      return this.parseRunRecord(results[0]!);
    } catch {
      return null;
    }
  }

  /**
   * Update fields on an existing run record.
   *
   * @param runId - The run to update
   * @param updates - Partial RunRecord fields to merge
   */
  updateRun(runId: RunId, updates: Partial<RunRecord>): void {
    const chore = this.findRunChore(runId);
    if (!chore) {
      throw new Error(`Run not found: ${runId}`);
    }

    const current = this.parseRunRecord(chore);
    const merged: RunRecord = { ...current, ...updates };

    // Rebuild the label list — replace wf-status label
    const existingLabels = (chore.labels ?? []).filter(
      (l) => !l.startsWith("wf-status:")
    );
    existingLabels.push(`wf-status:${merged.status}`);

    bdExec(this.beadsDir, [
      "update", chore.id,
      "--description", JSON.stringify(merged),
      "--labels", existingLabels.join(","),
    ]);
  }

  /**
   * List runs, optionally filtered by template name and/or status.
   *
   * @param params.templateName - Optional template filter
   * @param params.status - Optional RunStatus filter
   * @returns Array of matching RunRecords
   */
  listRuns(params?: { templateName?: string; status?: RunStatus }): RunRecord[] {
    const labelParts = ["kind:workflow-run"];
    if (params?.templateName) {
      labelParts.push(`template:${params.templateName}`);
    }
    if (params?.status) {
      labelParts.push(`wf-status:${params.status}`);
    }

    try {
      const results = bdJson<BeadsChore[]>(this.beadsDir, [
        "list",
        "--type", "chore",
        "--label", labelParts.join(","),
        "--include-infra",
        "--flat",
      ]);
      return results.map((r) => this.parseRunRecord(r));
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Stage operations
  // -------------------------------------------------------------------------

  /**
   * Create a new stage record for an existing run.
   *
   * @param params.runId - The parent run
   * @param params.stageId - Unique stage identifier within the run
   * @param params.timeout - Duration string (e.g. "5m")
   * @param params.onTimeout - Action to take on timeout
   * @returns The newly created StageRecord
   */
  createStage(params: {
    runId: RunId;
    stageId: StageId;
    timeout: string;
    onTimeout: OnTimeoutAction;
  }): StageRecord {
    const record: StageRecord = {
      runId: params.runId,
      stageId: params.stageId,
      attempt: 1,
      assignedAdapter: null,
      status: "pending",
      startedAt: null,
      finishedAt: null,
      timeout: params.timeout,
      onTimeout: params.onTimeout,
      resultSummary: null,
      artifactPaths: [],
      error: null,
    };

    const labels = [
      "kind:workflow-stage",
      `run:${params.runId}`,
      `stage:${params.stageId}`,
      `wf-stage-status:${record.status}`,
    ];

    bdJson<BeadsChore>(this.beadsDir, [
      "create",
      `workflow-stage: ${params.stageId}`,
      "--type", "chore",
      "--description", JSON.stringify(record),
      "--labels", labels.join(","),
      "--priority", "3",
    ]);

    return record;
  }

  /**
   * Retrieve a specific stage record.
   *
   * @param runId - The parent run identifier
   * @param stageId - The stage identifier
   * @returns The StageRecord or null if not found
   */
  getStage(runId: RunId, stageId: StageId): StageRecord | null {
    try {
      const results = bdJson<BeadsChore[]>(this.beadsDir, [
        "list",
        "--type", "chore",
        "--label", `kind:workflow-stage,run:${runId},stage:${stageId}`,
        "--include-infra",
        "--flat",
      ]);
      if (results.length === 0) return null;
      return this.parseStageRecord(results[0]!);
    } catch {
      return null;
    }
  }

  /**
   * Update fields on an existing stage record.
   *
   * @param runId - The parent run identifier
   * @param stageId - The stage identifier
   * @param updates - Partial StageRecord fields to merge
   */
  updateStage(
    runId: RunId,
    stageId: StageId,
    updates: Partial<StageRecord>
  ): void {
    const chore = this.findStageChore(runId, stageId);
    if (!chore) {
      throw new Error(`Stage not found: ${runId}/${stageId}`);
    }

    const current = this.parseStageRecord(chore);
    const merged: StageRecord = { ...current, ...updates };

    const existingLabels = (chore.labels ?? []).filter(
      (l) => !l.startsWith("wf-stage-status:")
    );
    existingLabels.push(`wf-stage-status:${merged.status}`);

    bdExec(this.beadsDir, [
      "update", chore.id,
      "--description", JSON.stringify(merged),
      "--labels", existingLabels.join(","),
    ]);
  }

  /**
   * Retrieve all stage records for a given run.
   *
   * @param runId - The run identifier
   * @returns Array of StageRecords
   */
  getStagesForRun(runId: RunId): StageRecord[] {
    try {
      const results = bdJson<BeadsChore[]>(this.beadsDir, [
        "list",
        "--type", "chore",
        "--label", `kind:workflow-stage,run:${runId}`,
        "--include-infra",
        "--flat",
      ]);
      return results.map((r) => this.parseStageRecord(r));
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private findRunChore(runId: RunId): BeadsChore | null {
    try {
      const results = bdJson<BeadsChore[]>(this.beadsDir, [
        "list",
        "--type", "chore",
        "--label", `kind:workflow-run,run:${runId}`,
        "--include-infra",
        "--flat",
      ]);
      return results[0] ?? null;
    } catch {
      return null;
    }
  }

  private findStageChore(runId: RunId, stageId: StageId): BeadsChore | null {
    try {
      const results = bdJson<BeadsChore[]>(this.beadsDir, [
        "list",
        "--type", "chore",
        "--label", `kind:workflow-stage,run:${runId},stage:${stageId}`,
        "--include-infra",
        "--flat",
      ]);
      return results[0] ?? null;
    } catch {
      return null;
    }
  }

  private parseRunRecord(chore: BeadsChore): RunRecord {
    if (!chore.description) {
      throw new Error(`Run chore ${chore.id} has no description`);
    }
    return JSON.parse(chore.description) as RunRecord;
  }

  private parseStageRecord(chore: BeadsChore): StageRecord {
    if (!chore.description) {
      throw new Error(`Stage chore ${chore.id} has no description`);
    }
    return JSON.parse(chore.description) as StageRecord;
  }
}
