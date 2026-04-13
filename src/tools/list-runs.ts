import { z } from "zod";
import type { RunStatus } from "../workflow-engine/types.js";
import { WorkflowPersistence } from "../workflow-engine/persistence.js";

const runStatusEnum = z.enum([
  "pending", "running", "completed", "failed", "cancelled", "timed_out",
]);

export const listRunsSchema = {
  template_name: z.string().optional().describe("Filter by workflow template name."),
  status: runStatusEnum.optional().describe("Filter by run status."),
};

export function handleListRuns(persistence: WorkflowPersistence) {
  return (args: { template_name?: string; status?: RunStatus }) => {
    const runs = persistence.listRuns({
      templateName: args.template_name,
      status: args.status,
    });

    if (runs.length === 0) {
      return { content: [{ type: "text" as const, text: "No workflow runs found." }] };
    }

    const lines = runs.map((r) => {
      const finished = r.finishedAt ? ` finished ${r.finishedAt}` : "";
      return `  ${r.status.padEnd(12)} ${r.runId}  ${r.templateName}  started ${r.startedAt}${finished}`;
    });

    return {
      content: [{ type: "text" as const, text: [`Workflow runs (${runs.length}):`, "", ...lines].join("\n") }],
    };
  };
}
