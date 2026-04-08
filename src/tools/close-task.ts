import { z } from "zod";
import type { Config } from "../config.js";
import { closeTask } from "../tasks.js";

export const closeTaskSchema = {
  task_id: z.string().describe("Task ID to close"),
  reason: z.string().optional().describe("Reason for closing"),
  suggest_next: z.boolean().optional().describe("Show newly unblocked tasks after closing"),
};

export function handleCloseTask(config: Config) {
  return (args: { task_id: string; reason?: string; suggest_next?: boolean }) => {
    const result = closeTask(config, args);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              task_id: result.id,
              title: result.title,
              status: result.status,
              closed: true,
            },
            null,
            2
          ),
        },
      ],
    };
  };
}
