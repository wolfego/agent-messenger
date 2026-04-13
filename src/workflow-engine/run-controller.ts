/**
 * RunController — orchestrates workflow lifecycle.
 *
 * Responsibilities:
 *   - Create runs and stage records (from a WorkflowDefinition)
 *   - Compute DAG-based stage readiness
 *   - Dispatch stage start/complete/fail transitions
 *   - Handle cancellation, timeout actions, and run completion checks
 *   - Support resumption after process restart
 */

import { WorkflowPersistence } from "./persistence.js";
import { TimeoutManager } from "./timeout-manager.js";
import type {
  RunId,
  StageId,
  RunRecord,
  StageRecord,
  RunSnapshot,
  WorkflowDefinition,
} from "./types.js";

// ---------------------------------------------------------------------------
// RunController
// ---------------------------------------------------------------------------

export class RunController {
  private readonly persistence: WorkflowPersistence;
  private readonly timeoutManager: TimeoutManager;

  /**
   * In-memory map from runId → WorkflowDefinition.
   *
   * Populated on createRun() and can be injected for resumeRun() scenarios
   * where the process has restarted and the definitions must be re-hydrated.
   */
  private readonly definitions = new Map<RunId, WorkflowDefinition>();

  /**
   * @param beadsDir - Absolute path to the .beads directory used for persistence
   */
  constructor(beadsDir: string) {
    this.persistence = new WorkflowPersistence(beadsDir);
    this.timeoutManager = new TimeoutManager();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Create a new workflow run and initialise all stage records as 'pending'.
   *
   * @param workflow - The workflow definition
   * @param createdBy - Agent ID initiating the run
   * @returns A snapshot containing the new RunRecord and all StageRecords
   */
  async createRun(
    workflow: WorkflowDefinition,
    createdBy: string
  ): Promise<RunSnapshot> {
    const run = this.persistence.createRun({
      templateName: workflow.name,
      description: workflow.description,
      createdBy,
    });

    const stages: StageRecord[] = [];
    for (const stageDef of workflow.stages) {
      const stage = this.persistence.createStage({
        runId: run.runId,
        stageId: stageDef.id,
        timeout: stageDef.timeout,
        onTimeout: stageDef.onTimeout,
      });
      stages.push(stage);
    }

    // Cache the definition for later use by this controller instance
    this.definitions.set(run.runId, workflow);

    return { run, stages };
  }

  /**
   * Retrieve a full snapshot of run + stage state from persistence.
   *
   * @param runId - The run identifier
   * @returns RunSnapshot with current persisted state
   */
  async getSnapshot(runId: RunId): Promise<RunSnapshot> {
    const run = this.persistence.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    const stages = this.persistence.getStagesForRun(runId);
    return { run, stages };
  }

  /**
   * Compute which stages are ready to be dispatched.
   *
   * A stage is ready when:
   *   - Its status is 'pending'
   *   - All stages listed in its 'needs' array have status 'completed'
   *
   * @param snapshot - Current run snapshot (from getSnapshot)
   * @returns Array of StageRecords that are ready to run
   */
  getReadyStages(snapshot: RunSnapshot): StageRecord[] {
    const workflow = this.definitions.get(snapshot.run.runId);
    if (!workflow) {
      return [];
    }

    const completedIds = new Set(
      snapshot.stages
        .filter((s) => s.status === "completed")
        .map((s) => s.stageId)
    );

    const pendingStages = snapshot.stages.filter((s) => s.status === "pending");

    // Build a lookup for stage definitions by id
    const defById = new Map(workflow.stages.map((d) => [d.id, d]));

    return pendingStages.filter((stage) => {
      const def = defById.get(stage.stageId);
      if (!def) return false;
      return def.needs.every((dep) => completedIds.has(dep));
    });
  }

  /**
   * Mark a stage as running and start its timeout timer.
   * Also transitions run status to 'running' and updates currentStageIds.
   *
   * @param runId - The run identifier
   * @param stageId - The stage to start
   * @param adapterId - ID of the adapter taking on the stage
   */
  async startStage(
    runId: RunId,
    stageId: StageId,
    adapterId: string
  ): Promise<void> {
    const now = new Date().toISOString();

    const stage = this.persistence.getStage(runId, stageId);
    if (!stage) {
      throw new Error(`Stage not found: ${runId}/${stageId}`);
    }

    this.persistence.updateStage(runId, stageId, {
      status: "running",
      startedAt: now,
      assignedAdapter: adapterId,
    });

    // Start the timeout timer for this stage
    this.timeoutManager.startTimer(
      runId,
      stageId,
      stage.timeout,
      (timedOutRunId, timedOutStageId) => {
        void this.handleTimeout(timedOutRunId, timedOutStageId);
      }
    );

    // Transition run to 'running' and add stage to currentStageIds
    const run = this.persistence.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const currentStageIds = run.currentStageIds.includes(stageId)
      ? run.currentStageIds
      : [...run.currentStageIds, stageId];

    this.persistence.updateRun(runId, {
      status: "running",
      currentStageIds,
    });
  }

  /**
   * Mark a stage as completed, cancel its timer, and check whether the
   * overall run has finished.
   *
   * @param runId - The run identifier
   * @param stageId - The stage that completed
   * @param resultSummary - Human-readable summary of the stage output
   */
  async completeStage(
    runId: RunId,
    stageId: StageId,
    resultSummary: string
  ): Promise<void> {
    this.timeoutManager.cancelTimer(runId, stageId);

    this.persistence.updateStage(runId, stageId, {
      status: "completed",
      finishedAt: new Date().toISOString(),
      resultSummary,
    });

    this.removeFromCurrentStages(runId, stageId);
    this.checkRunCompletion(runId);
  }

  /**
   * Mark a stage as failed, mark the run as failed, and cancel all timers
   * associated with the run.
   *
   * @param runId - The run identifier
   * @param stageId - The stage that failed
   * @param error - Error message describing the failure
   */
  async failStage(
    runId: RunId,
    stageId: StageId,
    error: string
  ): Promise<void> {
    this.timeoutManager.cancelAllForRun(runId);

    this.persistence.updateStage(runId, stageId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error,
    });

    this.persistence.updateRun(runId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error,
    });
  }

  /**
   * Cancel all non-terminal stages and mark the run as cancelled.
   *
   * @param runId - The run identifier
   * @param reason - Human-readable cancellation reason
   */
  async cancelRun(runId: RunId, reason: string): Promise<void> {
    this.timeoutManager.cancelAllForRun(runId);

    const stages = this.persistence.getStagesForRun(runId);
    const terminalStatuses = new Set([
      "completed",
      "failed",
      "cancelled",
      "timed_out",
    ]);

    for (const stage of stages) {
      if (!terminalStatuses.has(stage.status)) {
        this.persistence.updateStage(runId, stage.stageId, {
          status: "cancelled",
          finishedAt: new Date().toISOString(),
          error: reason,
        });
      }
    }

    this.persistence.updateRun(runId, {
      status: "cancelled",
      finishedAt: new Date().toISOString(),
      error: reason,
      currentStageIds: [],
    });
  }

  /**
   * Re-register timeout timers for any stages currently in 'running' status.
   *
   * Intended for use after a process restart where in-memory timer state has
   * been lost. The workflow definition must be injected into `this.definitions`
   * before calling this method (or loaded via config on startup).
   *
   * @param runId - The run to resume
   */
  async resumeRun(runId: RunId): Promise<void> {
    const run = this.persistence.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (run.status !== "running") {
      return;
    }

    const stages = this.persistence.getStagesForRun(runId);
    const runningStages = stages.filter((s) => s.status === "running");

    for (const stage of runningStages) {
      // Re-register the timer using the full configured timeout.
      // (Remaining-time tracking is a future enhancement; this is safe because
      //  a slightly generous deadline is better than a missed one after restart.)
      this.timeoutManager.startTimer(
        runId,
        stage.stageId,
        stage.timeout,
        (timedOutRunId, timedOutStageId) => {
          void this.handleTimeout(timedOutRunId, timedOutStageId);
        }
      );
    }
  }

  /**
   * Cancel all timers managed by this controller instance.
   * Call on shutdown or test teardown.
   */
  dispose(): void {
    this.timeoutManager.dispose();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Handle a stage timeout according to the stage's onTimeout action.
   *
   * - 'fail'     → mark stage timed_out, mark run timed_out, cancel all timers
   * - 'cancel'   → mark stage cancelled only (run continues)
   * - 'continue' → mark stage completed with a timeout note, check run completion
   *
   * @param runId - The run containing the timed-out stage
   * @param stageId - The stage that timed out
   */
  private handleTimeout(runId: RunId, stageId: StageId): void {
    const stage = this.persistence.getStage(runId, stageId);
    if (!stage) return;

    const now = new Date().toISOString();

    switch (stage.onTimeout) {
      case "fail": {
        this.timeoutManager.cancelAllForRun(runId);
        this.persistence.updateStage(runId, stageId, {
          status: "timed_out",
          finishedAt: now,
          error: `Stage timed out after ${stage.timeout}`,
        });
        this.persistence.updateRun(runId, {
          status: "timed_out",
          finishedAt: now,
          error: `Stage ${stageId} timed out`,
          currentStageIds: [],
        });
        break;
      }

      case "cancel": {
        this.persistence.updateStage(runId, stageId, {
          status: "cancelled",
          finishedAt: now,
          error: `Stage timed out after ${stage.timeout}`,
        });
        this.removeFromCurrentStages(runId, stageId);
        // Run continues — do NOT fail the run
        break;
      }

      case "continue": {
        this.persistence.updateStage(runId, stageId, {
          status: "completed",
          finishedAt: now,
          resultSummary: `[timed out after ${stage.timeout}] continuing`,
        });
        this.removeFromCurrentStages(runId, stageId);
        this.checkRunCompletion(runId);
        break;
      }
    }
  }

  /**
   * Remove a stage from the run's currentStageIds list.
   *
   * @param runId - The run to update
   * @param stageId - The stage to remove
   */
  private removeFromCurrentStages(runId: RunId, stageId: StageId): void {
    const run = this.persistence.getRun(runId);
    if (!run) return;

    const currentStageIds = run.currentStageIds.filter((id) => id !== stageId);
    this.persistence.updateRun(runId, { currentStageIds });
  }

  /**
   * Check whether all stages for a run are terminal, and update run status
   * to 'completed' or 'failed' accordingly.
   *
   * Called after any stage reaches a terminal state via completeStage or
   * the 'continue' timeout path.
   *
   * @param runId - The run to check
   */
  private checkRunCompletion(runId: RunId): void {
    const stages = this.persistence.getStagesForRun(runId);
    const terminalStatuses = new Set([
      "completed",
      "failed",
      "cancelled",
      "timed_out",
    ]);

    const allTerminal = stages.every((s) => terminalStatuses.has(s.status));
    if (!allTerminal) return;

    const allCompleted = stages.every((s) => s.status === "completed");
    const finalStatus = allCompleted ? "completed" : "failed";

    this.persistence.updateRun(runId, {
      status: finalStatus,
      finishedAt: new Date().toISOString(),
      currentStageIds: [],
    });
  }
}
