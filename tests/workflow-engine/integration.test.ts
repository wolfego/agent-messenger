// tests/workflow-engine/integration.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WorkflowDefinition } from "../../src/workflow-engine/types.js";

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

describe.skipIf(!canRun)("Workflow Engine E2E", () => {
  let tmpDir: string;
  let beadsDir: string;
  let RunController: typeof import("../../src/workflow-engine/run-controller.js").RunController;
  let WorkflowPersistence: typeof import("../../src/workflow-engine/persistence.js").WorkflowPersistence;
  let getParallelBrainstormWorkflow: typeof import("../../src/workflow-engine/hardcoded-brainstorm.js").getParallelBrainstormWorkflow;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wf-e2e-test-"));
    beadsDir = join(tmpDir, ".beads");

    execFileSync("bd", ["init", "--server"], {
      cwd: tmpDir,
      encoding: "utf-8",
      timeout: 30_000,
      windowsHide: true,
    });

    ({ RunController } = await import("../../src/workflow-engine/run-controller.js"));
    ({ WorkflowPersistence } = await import("../../src/workflow-engine/persistence.js"));
    ({ getParallelBrainstormWorkflow } = await import("../../src/workflow-engine/hardcoded-brainstorm.js"));
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
    } catch { /* best-effort */ }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  });

  it("runs a full parallel brainstorm workflow end-to-end", async () => {
    const controller = new RunController(beadsDir);
    const persistence = new WorkflowPersistence(beadsDir);

    try {
      const workflow = getParallelBrainstormWorkflow("Build a trial comparison feature");
      const snapshot = await controller.createRun(workflow, "test-agent");

      // 1. Initial state
      expect(snapshot.run.status).toBe("pending");
      expect(snapshot.stages.length).toBe(3);

      const ready1 = controller.getReadyStages(snapshot);
      expect(ready1.map((s) => s.stageId).sort()).toEqual(["brainstorm-analytical", "brainstorm-creative"]);

      // 2. Start both parallel stages
      await controller.startStage(snapshot.run.runId, "brainstorm-creative", "cc-1");
      await controller.startStage(snapshot.run.runId, "brainstorm-analytical", "cc-2");

      const snap2 = await controller.getSnapshot(snapshot.run.runId);
      expect(snap2.run.status).toBe("running");

      // 3. Complete both
      await controller.completeStage(snapshot.run.runId, "brainstorm-creative", "Creative ideas");
      await controller.completeStage(snapshot.run.runId, "brainstorm-analytical", "Technical approaches");

      // 4. Synthesize ready
      const snap3 = await controller.getSnapshot(snapshot.run.runId);
      const ready3 = controller.getReadyStages(snap3);
      expect(ready3.map((s) => s.stageId)).toEqual(["synthesize"]);

      // 5. Complete synthesize
      await controller.startStage(snapshot.run.runId, "synthesize", "cc-1");
      await controller.completeStage(snapshot.run.runId, "synthesize", "3 ranked recommendations");

      // 6. Run completed
      const final = await controller.getSnapshot(snapshot.run.runId);
      expect(final.run.status).toBe("completed");
      expect(final.run.finishedAt).toBeTruthy();
      expect(final.stages.every((s) => s.status === "completed")).toBe(true);

      // 7. Listed in runs
      const runs = persistence.listRuns({ templateName: "parallel-brainstorm" });
      expect(runs.some((r) => r.runId === snapshot.run.runId)).toBe(true);
    } finally {
      controller.dispose();
    }
  });

  it("handles stage failure — fails the entire run", async () => {
    const controller = new RunController(beadsDir);

    try {
      const workflow = getParallelBrainstormWorkflow("Failing test");
      const snapshot = await controller.createRun(workflow, "test-agent");

      await controller.startStage(snapshot.run.runId, "brainstorm-creative", "cc-1");
      await controller.failStage(snapshot.run.runId, "brainstorm-creative", "Agent disconnected");

      const final = await controller.getSnapshot(snapshot.run.runId);
      expect(final.run.status).toBe("failed");
      expect(final.run.error).toContain("Agent disconnected");
    } finally {
      controller.dispose();
    }
  });

  it("resumes run after simulated restart", async () => {
    const controller1 = new RunController(beadsDir);
    const workflow = getParallelBrainstormWorkflow("Resume test");
    let runId: string;

    try {
      const snapshot = await controller1.createRun(workflow, "test-agent");
      runId = snapshot.run.runId;

      await controller1.startStage(runId, "brainstorm-creative", "cc-1");
      await controller1.completeStage(runId, "brainstorm-creative", "Done");
    } finally {
      controller1.dispose();
    }

    const controller2 = new RunController(beadsDir);
    try {
      (controller2 as unknown as { definitions: Map<string, WorkflowDefinition> })
        .definitions.set(runId, workflow);

      await controller2.resumeRun(runId);

      const snap = await controller2.getSnapshot(runId);
      expect(snap.run.status).toBe("running");

      const ready = controller2.getReadyStages(snap);
      expect(ready.map((s) => s.stageId)).toContain("brainstorm-analytical");
    } finally {
      controller2.dispose();
    }
  });
});
