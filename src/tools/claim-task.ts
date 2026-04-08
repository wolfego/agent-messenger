import { z } from "zod";
import type { Config } from "../config.js";
import { claimTask } from "../tasks.js";

export const claimTaskSchema = {
  task_id: z.string().describe("Task ID to claim (atomically assigns to you and sets status to in_progress)"),
};

export function handleClaimTask(config: Config) {
  return (args: { task_id: string }) => {
    const result = claimTask(config, args.task_id);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              task_id: result.id,
              title: result.title,
              status: result.status,
              assignee: result.owner ?? null,
              claimed: true,
            },
            null,
            2
          ),
        },
      ],
    };
  };
}
