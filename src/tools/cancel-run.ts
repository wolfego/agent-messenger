import { z } from "zod";
import { RunController } from "../workflow-engine/run-controller.js";

export const cancelRunSchema = {
  run_id: z.string().describe("The run ID to cancel."),
  reason: z.string().optional().describe("Reason for cancellation."),
};

export function handleCancelRun(controller: RunController) {
  return async (args: { run_id: string; reason?: string }) => {
    const reason = args.reason ?? "Cancelled by user";
    await controller.cancelRun(args.run_id, reason);
    return {
      content: [{ type: "text" as const, text: `Run ${args.run_id} cancelled. Reason: ${reason}` }],
    };
  };
}
