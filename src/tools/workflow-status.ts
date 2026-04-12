import { z } from "zod";
import type { Config } from "../config.js";
import { queryWorkflowCheckpoints, type WorkflowCheckpoint } from "../beads.js";

export const workflowStatusSchema = {
  workflow: z.string().optional().describe("Filter by workflow name (e.g. 'orchestrate', 'debug'). Omit to see all."),
  feature: z.string().optional().describe("Filter by feature name. Omit to see all active workflows."),
};

interface FeatureStatus {
  workflow: string;
  feature: string;
  current_phase: string;
  phase_status: string;
  started_at: string;
  checkpoints: Array<{ phase: string; status: string; timestamp: string }>;
}

export function handleWorkflowStatus(config: Config) {
  return (args: { workflow?: string; feature?: string }) => {
    const checkpoints = queryWorkflowCheckpoints(config, {
      workflow: args.workflow,
      feature: args.feature,
    });

    if (checkpoints.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "ok",
            message: "No active workflows found.",
            workflows: [],
          }),
        }],
      };
    }

    const byFeature = new Map<string, WorkflowCheckpoint[]>();
    for (const cp of checkpoints) {
      const key = `${cp.workflow}::${cp.feature}`;
      const existing = byFeature.get(key) ?? [];
      existing.push(cp);
      byFeature.set(key, existing);
    }

    const workflows: FeatureStatus[] = [];
    for (const [, cps] of byFeature) {
      const sorted = cps.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      const latest = sorted[0]!;
      const earliest = sorted[sorted.length - 1]!;

      workflows.push({
        workflow: latest.workflow,
        feature: latest.feature,
        current_phase: latest.phase,
        phase_status: latest.status,
        started_at: earliest.timestamp,
        checkpoints: sorted.map((cp) => ({
          phase: cp.phase,
          status: cp.status,
          timestamp: cp.timestamp,
        })),
      });
    }

    workflows.sort(
      (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    );

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "ok",
          count: workflows.length,
          workflows,
        }, null, 2),
      }],
    };
  };
}
