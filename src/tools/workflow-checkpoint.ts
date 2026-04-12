import { z } from "zod";
import type { Config } from "../config.js";
import { createWorkflowCheckpoint } from "../beads.js";

export const workflowCheckpointSchema = {
  workflow: z.string().describe("Workflow name (e.g. 'orchestrate', 'debug')"),
  feature: z.string().describe("Feature or task being worked on (e.g. 'WebSocket support', 'login timeout bug')"),
  phase: z.string().describe("Current phase (e.g. 'brainstorm', 'spec', 'spec-review', 'plan', 'plan-review', 'implement', 'verify', 'closeout' for orchestrate; 'triage', 'hypothesize', 'investigate', 'diagnose', 'fix', 'verify', 'closeout' for debug)"),
  status: z.enum(["started", "completed"]).describe("Whether the phase is starting or finishing"),
};

export function handleWorkflowCheckpoint(config: Config) {
  return (args: {
    workflow: string;
    feature: string;
    phase: string;
    status: "started" | "completed";
  }) => {
    const result = createWorkflowCheckpoint(config, args);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "ok",
          checkpoint_id: result.id,
          workflow: args.workflow,
          feature: args.feature,
          phase: args.phase,
          phase_status: args.status,
          message: `Checkpoint recorded: ${args.workflow} / ${args.feature} — ${args.phase} ${args.status}`,
        }),
      }],
    };
  };
}
