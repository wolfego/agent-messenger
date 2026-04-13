import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunRecord, StageRecord } from "../../src/workflow-engine/types.js";

// ---------------------------------------------------------------------------
// Guard: skip if bd is not available
// ---------------------------------------------------------------------------

function hasBd(): boolean {
  try {
    execFileSync("bd", ["--version"], {
      encoding: "utf-8",
      timeout: 5_000,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

const canRun = hasBd();

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skipIf(!canRun)("WorkflowPersistence", () => {
  let tmpDir: string;
  let beadsDir: string;
  let persistence: import("../../src/workflow-engine/persistence.js").WorkflowPersistence;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wf-persist-test-"));
    beadsDir = join(tmpDir, ".beads");

    execFileSync("bd", ["init", "--server"], {
      cwd: tmpDir,
      encoding: "utf-8",
      timeout: 30_000,
      windowsHide: true,
      env: { ...process.env },
    });

    const { WorkflowPersistence } = await import("../../src/workflow-engine/persistence.js");
    persistence = new WorkflowPersistence(beadsDir);
  }, 60_000);

  afterAll(() => {
    try {
      execFileSync("bd", ["dolt", "stop"], {
        cwd: tmpDir,
        encoding: "utf-8",
        timeout: 10_000,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, BEADS_DIR: beadsDir },
      });
    } catch {
      // Ignore — may not be running
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  // -------------------------------------------------------------------------
  // Run CRUD
  // -------------------------------------------------------------------------

  it("creates a workflow run record", () => {
    const run = persistence.createRun({
      templateName: "test-template",
      description: "A test run",
      createdBy: "agent-test",
    });

    expect(run.runId).toMatch(/^run-[0-9a-f]{8}$/);
    expect(run.templateName).toBe("test-template");
    expect(run.description).toBe("A test run");
    expect(run.createdBy).toBe("agent-test");
    expect(run.status).toBe("pending");
    expect(run.finishedAt).toBeNull();
    expect(run.error).toBeNull();
    expect(run.currentStageIds).toEqual([]);
    expect(typeof run.startedAt).toBe("string");
  });

  it("retrieves a run by runId", () => {
    const created = persistence.createRun({
      templateName: "retrieve-test",
      description: "Retrieve me",
      createdBy: "agent-test",
    });

    const fetched = persistence.getRun(created.runId);
    expect(fetched).not.toBeNull();
    expect(fetched!.runId).toBe(created.runId);
    expect(fetched!.templateName).toBe("retrieve-test");
    expect(fetched!.status).toBe("pending");
  });

  it("returns null for a non-existent run", () => {
    const result = persistence.getRun("run-00000000");
    expect(result).toBeNull();
  });

  it("updates run status", () => {
    const run = persistence.createRun({
      templateName: "update-test",
      description: "Update my status",
      createdBy: "agent-test",
    });

    persistence.updateRun(run.runId, { status: "running" });

    const updated = persistence.getRun(run.runId);
    expect(updated!.status).toBe("running");
  });

  it("updates run with finishedAt and error", () => {
    const run = persistence.createRun({
      templateName: "finish-test",
      description: "Finish me",
      createdBy: "agent-test",
    });

    const finishedAt = new Date().toISOString();
    persistence.updateRun(run.runId, {
      status: "failed",
      finishedAt,
      error: "something went wrong",
    });

    const updated = persistence.getRun(run.runId);
    expect(updated!.status).toBe("failed");
    expect(updated!.finishedAt).toBe(finishedAt);
    expect(updated!.error).toBe("something went wrong");
  });

  // -------------------------------------------------------------------------
  // Stage CRUD
  // -------------------------------------------------------------------------

  it("creates and retrieves a stage record", () => {
    const run = persistence.createRun({
      templateName: "stage-test",
      description: "Run for stage tests",
      createdBy: "agent-test",
    });

    const stage = persistence.createStage({
      runId: run.runId,
      stageId: "stage-brainstorm",
      timeout: "5m",
      onTimeout: "fail",
    });

    expect(stage.runId).toBe(run.runId);
    expect(stage.stageId).toBe("stage-brainstorm");
    expect(stage.status).toBe("pending");
    expect(stage.attempt).toBe(1);
    expect(stage.assignedAdapter).toBeNull();
    expect(stage.timeout).toBe("5m");
    expect(stage.onTimeout).toBe("fail");
    expect(stage.startedAt).toBeNull();
    expect(stage.finishedAt).toBeNull();
    expect(stage.resultSummary).toBeNull();
    expect(stage.artifactPaths).toEqual([]);
    expect(stage.error).toBeNull();

    const fetched = persistence.getStage(run.runId, "stage-brainstorm");
    expect(fetched).not.toBeNull();
    expect(fetched!.stageId).toBe("stage-brainstorm");
  });

  it("returns null for a non-existent stage", () => {
    const run = persistence.createRun({
      templateName: "null-stage-test",
      description: "Run for null stage check",
      createdBy: "agent-test",
    });

    const result = persistence.getStage(run.runId, "stage-nope");
    expect(result).toBeNull();
  });

  it("updates stage status and result", () => {
    const run = persistence.createRun({
      templateName: "stage-update-test",
      description: "Run for stage update tests",
      createdBy: "agent-test",
    });

    persistence.createStage({
      runId: run.runId,
      stageId: "stage-write",
      timeout: "10m",
      onTimeout: "cancel",
    });

    const startedAt = new Date().toISOString();
    persistence.updateStage(run.runId, "stage-write", {
      status: "running",
      startedAt,
      assignedAdapter: "claude-code",
    });

    const mid = persistence.getStage(run.runId, "stage-write");
    expect(mid!.status).toBe("running");
    expect(mid!.startedAt).toBe(startedAt);
    expect(mid!.assignedAdapter).toBe("claude-code");

    const finishedAt = new Date().toISOString();
    persistence.updateStage(run.runId, "stage-write", {
      status: "completed",
      finishedAt,
      resultSummary: "wrote 500 words",
      artifactPaths: ["/tmp/output.md"],
    });

    const done = persistence.getStage(run.runId, "stage-write");
    expect(done!.status).toBe("completed");
    expect(done!.finishedAt).toBe(finishedAt);
    expect(done!.resultSummary).toBe("wrote 500 words");
    expect(done!.artifactPaths).toEqual(["/tmp/output.md"]);
  });

  it("lists stages for a run", () => {
    const run = persistence.createRun({
      templateName: "list-stages-test",
      description: "Run for listing stages",
      createdBy: "agent-test",
    });

    persistence.createStage({ runId: run.runId, stageId: "stage-a", timeout: "5m", onTimeout: "fail" });
    persistence.createStage({ runId: run.runId, stageId: "stage-b", timeout: "5m", onTimeout: "fail" });
    persistence.createStage({ runId: run.runId, stageId: "stage-c", timeout: "5m", onTimeout: "fail" });

    const stages = persistence.getStagesForRun(run.runId);
    expect(stages).toHaveLength(3);
    const stageIds = stages.map((s: StageRecord) => s.stageId).sort();
    expect(stageIds).toEqual(["stage-a", "stage-b", "stage-c"]);
  });

  // -------------------------------------------------------------------------
  // listRuns with filters
  // -------------------------------------------------------------------------

  it("lists runs filtered by template name", () => {
    // Create a couple with a unique template name to avoid collision with earlier tests
    const unique = `tmpl-${Date.now()}`;
    persistence.createRun({ templateName: unique, description: "run 1", createdBy: "agent-test" });
    persistence.createRun({ templateName: unique, description: "run 2", createdBy: "agent-test" });
    persistence.createRun({ templateName: "other-template", description: "other", createdBy: "agent-test" });

    const filtered = persistence.listRuns({ templateName: unique });
    expect(filtered.length).toBeGreaterThanOrEqual(2);
    for (const r of filtered) {
      expect(r.templateName).toBe(unique);
    }
  });

  it("lists all runs when no filter provided", () => {
    const all = persistence.listRuns();
    // We've created at least 8 runs across all tests
    expect(all.length).toBeGreaterThanOrEqual(8);
  });

  it("lists runs filtered by status", () => {
    const templateName = `status-filter-${Date.now()}`;
    const r1 = persistence.createRun({ templateName, description: "r1", createdBy: "agent-test" });
    const r2 = persistence.createRun({ templateName, description: "r2", createdBy: "agent-test" });

    persistence.updateRun(r1.runId, { status: "running" });
    // r2 stays pending

    const running = persistence.listRuns({ status: "running" });
    const runIds = running.map((r: RunRecord) => r.runId);
    expect(runIds).toContain(r1.runId);
    expect(runIds).not.toContain(r2.runId);
  });
});
