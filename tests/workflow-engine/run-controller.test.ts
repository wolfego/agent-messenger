import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WorkflowDefinition } from "../../src/workflow-engine/types.js";

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
// Test workflow definition
// ---------------------------------------------------------------------------

const testWorkflow: WorkflowDefinition = {
  name: "test-workflow",
  description: "Two parallel stages and a merge",
  stages: [
    {
      id: "brainstorm-1",
      needs: [],
      prompt: "Brainstorm testing",
      timeout: "15m",
      onTimeout: "fail",
    },
    {
      id: "brainstorm-2",
      needs: [],
      prompt: "Brainstorm quality",
      timeout: "15m",
      onTimeout: "fail",
    },
    {
      id: "synthesize",
      needs: ["brainstorm-1", "brainstorm-2"],
      prompt: "Merge outputs",
      timeout: "10m",
      onTimeout: "cancel",
    },
  ],
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skipIf(!canRun)("RunController", () => {
  let tmpDir: string;
  let beadsDir: string;
  let RunController: typeof import("../../src/workflow-engine/run-controller.js").RunController;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wf-run-controller-test-"));
    beadsDir = join(tmpDir, ".beads");

    execFileSync("bd", ["init", "--server"], {
      cwd: tmpDir,
      encoding: "utf-8",
      timeout: 30_000,
      windowsHide: true,
      env: { ...process.env },
    });

    ({ RunController } = await import(
      "../../src/workflow-engine/run-controller.js"
    ));
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
  // Test 1: Creates a run with all stages in pending state
  // -------------------------------------------------------------------------

  it("creates a run with all stages in pending state", async () => {
    const controller = new RunController(beadsDir);

    try {
      const { run, stages } = await controller.createRun(
        testWorkflow,
        "agent-test"
      );

      expect(run.runId).toMatch(/^run-[0-9a-f]{8}$/);
      expect(run.templateName).toBe("test-workflow");
      expect(run.status).toBe("pending");
      expect(run.createdBy).toBe("agent-test");

      expect(stages).toHaveLength(3);
      for (const stage of stages) {
        expect(stage.status).toBe("pending");
      }

      const stageIds = stages.map((s) => s.stageId).sort();
      expect(stageIds).toEqual(["brainstorm-1", "brainstorm-2", "synthesize"]);
    } finally {
      controller.dispose();
    }
  });

  // -------------------------------------------------------------------------
  // Test 2: getReadyStages returns only stages with no unmet dependencies
  // -------------------------------------------------------------------------

  it("getReadyStages returns only stages with no unmet dependencies", async () => {
    const controller = new RunController(beadsDir);

    try {
      const { run } = await controller.createRun(testWorkflow, "agent-test");
      const snapshot = await controller.getSnapshot(run.runId);

      const ready = controller.getReadyStages(snapshot);

      // Only brainstorm-1 and brainstorm-2 have no deps
      expect(ready).toHaveLength(2);
      const readyIds = ready.map((s) => s.stageId).sort();
      expect(readyIds).toEqual(["brainstorm-1", "brainstorm-2"]);
    } finally {
      controller.dispose();
    }
  });

  // -------------------------------------------------------------------------
  // Test 3: getReadyStages excludes stages with pending dependencies
  // -------------------------------------------------------------------------

  it("getReadyStages excludes stages with pending dependencies", async () => {
    const controller = new RunController(beadsDir);

    try {
      const { run } = await controller.createRun(testWorkflow, "agent-test");

      // Start both brainstorm stages but only complete one
      await controller.startStage(run.runId, "brainstorm-1", "adapter-1");
      await controller.completeStage(run.runId, "brainstorm-1", "done");

      const snapshot = await controller.getSnapshot(run.runId);
      const ready = controller.getReadyStages(snapshot);

      // brainstorm-2 is still pending (no deps), synthesize should NOT be ready
      const readyIds = ready.map((s) => s.stageId).sort();
      expect(readyIds).toContain("brainstorm-2");
      expect(readyIds).not.toContain("synthesize");
    } finally {
      controller.dispose();
    }
  });

  // -------------------------------------------------------------------------
  // Test 4: completeStage marks stage as completed and unblocks dependents
  // -------------------------------------------------------------------------

  it("completeStage marks stage as completed and unblocks dependents", async () => {
    const controller = new RunController(beadsDir);

    try {
      const { run } = await controller.createRun(testWorkflow, "agent-test");

      // Complete both dependencies
      await controller.startStage(run.runId, "brainstorm-1", "adapter-1");
      await controller.completeStage(run.runId, "brainstorm-1", "result-1");

      await controller.startStage(run.runId, "brainstorm-2", "adapter-2");
      await controller.completeStage(run.runId, "brainstorm-2", "result-2");

      const snapshot = await controller.getSnapshot(run.runId);
      const ready = controller.getReadyStages(snapshot);

      // Now synthesize should be ready
      expect(ready).toHaveLength(1);
      expect(ready[0]!.stageId).toBe("synthesize");

      // Verify stage records
      const b1 = snapshot.stages.find((s) => s.stageId === "brainstorm-1");
      expect(b1?.status).toBe("completed");
      expect(b1?.resultSummary).toBe("result-1");
      expect(b1?.finishedAt).not.toBeNull();
    } finally {
      controller.dispose();
    }
  });

  // -------------------------------------------------------------------------
  // Test 5: cancelRun marks all pending/running stages as cancelled
  // -------------------------------------------------------------------------

  it("cancelRun marks all pending/running stages as cancelled", async () => {
    const controller = new RunController(beadsDir);

    try {
      const { run } = await controller.createRun(testWorkflow, "agent-test");

      // Start brainstorm-1 (running), leave brainstorm-2 + synthesize pending
      await controller.startStage(run.runId, "brainstorm-1", "adapter-1");

      await controller.cancelRun(run.runId, "user requested cancel");

      const snapshot = await controller.getSnapshot(run.runId);

      expect(snapshot.run.status).toBe("cancelled");

      for (const stage of snapshot.stages) {
        expect(["cancelled", "completed", "failed", "timed_out"]).toContain(
          stage.status
        );
      }

      const b1 = snapshot.stages.find((s) => s.stageId === "brainstorm-1");
      expect(b1?.status).toBe("cancelled");

      const b2 = snapshot.stages.find((s) => s.stageId === "brainstorm-2");
      expect(b2?.status).toBe("cancelled");
    } finally {
      controller.dispose();
    }
  });

  // -------------------------------------------------------------------------
  // Test 6: resumes a run after simulated restart
  // -------------------------------------------------------------------------

  it("resumes a run after simulated restart", async () => {
    const controller1 = new RunController(beadsDir);
    let runId: string;

    try {
      const { run } = await controller1.createRun(testWorkflow, "agent-test");
      runId = run.runId;

      // Start brainstorm-1 — this registers a timer in controller1
      await controller1.startStage(runId, "brainstorm-1", "adapter-1");
    } finally {
      // Dispose controller1 — simulates process restart (timers lost)
      controller1.dispose();
    }

    // Simulate restart: new controller pointing at same temp dir
    const controller2 = new RunController(beadsDir);

    try {
      // Inject workflow definition (would normally come from config on startup)
      controller2.registerDefinition(runId, testWorkflow);

      await controller2.resumeRun(runId);

      const snapshot = await controller2.getSnapshot(runId);

      // Run should still be running with brainstorm-1 active
      expect(snapshot.run.status).toBe("running");

      const b1 = snapshot.stages.find((s) => s.stageId === "brainstorm-1");
      expect(b1?.status).toBe("running");
    } finally {
      controller2.dispose();
    }
  });
});
