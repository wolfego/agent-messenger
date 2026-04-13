import { z } from "zod";
import { RunController } from "../workflow-engine/run-controller.js";

export const runStatusSchema = {
  run_id: z.string().describe("The run ID to check status for."),
};

export function handleRunStatus(controller: RunController) {
  return async (args: { run_id: string }) => {
    const snapshot = await controller.getSnapshot(args.run_id);
    const readyStages = controller.getReadyStages(snapshot);

    const stageLines = snapshot.stages.map((s) => {
      const adapter = s.assignedAdapter ? ` (${s.assignedAdapter})` : "";
      const result = s.resultSummary ? ` — ${s.resultSummary.slice(0, 80)}` : "";
      const error = s.error ? ` [ERROR: ${s.error}]` : "";
      return `  ${s.status.padEnd(18)} ${s.stageId}${adapter}${result}${error}`;
    });

    const readyList = readyStages.length > 0
      ? `\nReady stages: ${readyStages.map((s) => s.stageId).join(", ")}`
      : "";

    return {
      content: [{
        type: "text" as const,
        text: [
          `Run: ${snapshot.run.runId}`,
          `Template: ${snapshot.run.templateName}`,
          `Status: ${snapshot.run.status}`,
          `Started: ${snapshot.run.startedAt}`,
          snapshot.run.finishedAt ? `Finished: ${snapshot.run.finishedAt}` : null,
          snapshot.run.error ? `Error: ${snapshot.run.error}` : null,
          "",
          "Stages:",
          ...stageLines,
          readyList,
        ].filter((line): line is string => line !== null).join("\n"),
      }],
    };
  };
}
