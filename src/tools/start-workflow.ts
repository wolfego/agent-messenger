import { z } from "zod";
import type { Config } from "../config.js";
import { RunController } from "../workflow-engine/run-controller.js";
import { getParallelBrainstormWorkflow } from "../workflow-engine/hardcoded-brainstorm.js";

export const startWorkflowSchema = {
  workflow: z.enum(["parallel-brainstorm"]).describe("Which workflow to run. Currently only 'parallel-brainstorm' is available."),
  description: z.string().describe("Description of the task or feature to brainstorm."),
};

export function handleStartWorkflow(config: Config, controller: RunController) {
  return async (args: { workflow: "parallel-brainstorm"; description: string }) => {
    const workflowDef = getParallelBrainstormWorkflow(args.description);
    const snapshot = await controller.createRun(workflowDef, config.agentId);
    const readyStages = controller.getReadyStages(snapshot);
    const readyList = readyStages.map((s) => `  - ${s.stageId}`).join("\n");

    return {
      content: [{
        type: "text" as const,
        text: [
          `Workflow "${args.workflow}" started.`,
          `Run ID: ${snapshot.run.runId}`,
          `Stages: ${snapshot.stages.length}`,
          `Ready to execute:`,
          readyList,
          "",
          "Use run_status to check progress.",
        ].join("\n"),
      }],
    };
  };
}
