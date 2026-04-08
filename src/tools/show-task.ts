import { z } from "zod";
import type { Config } from "../config.js";
import { showTask } from "../tasks.js";

export const showTaskSchema = {
  task_id: z.string().describe("Task ID to show (e.g. 'agent-messenger-z1b.1')"),
  long: z.boolean().optional().describe("Show all available fields including metadata"),
  children: z.boolean().optional().describe("Show only the children/subtasks of this issue"),
};

export function handleShowTask(config: Config) {
  return (args: { task_id: string; long?: boolean; children?: boolean }) => {
    const result = showTask(config, args);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  };
}
