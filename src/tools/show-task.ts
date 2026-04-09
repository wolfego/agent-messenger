import { z } from "zod";
import type { Config } from "../config.js";
import { showTask } from "../tasks.js";
import { listLinkedMessages } from "../beads.js";

export const showTaskSchema = {
  task_id: z.string().describe("Task ID to show (e.g. 'agent-messenger-z1b.1')"),
  long: z.boolean().optional().describe("Show all available fields including metadata"),
  children: z.boolean().optional().describe("Show only the children/subtasks of this issue"),
};

export function handleShowTask(config: Config) {
  return (args: { task_id: string; long?: boolean; children?: boolean }) => {
    const result = showTask(config, args);

    const linked = args.children ? [] : listLinkedMessages(config, args.task_id);
    const output: Record<string, unknown> = { task: result };
    if (linked.length > 0) {
      output["linked_messages"] = linked.map((m) => ({
        id: m.id,
        subject: m.title,
        from: m.labels?.find((l) => l.startsWith("from:"))?.slice(5),
        to: m.labels?.find((l) => l.startsWith("to:"))?.slice(3),
        created_at: m.created_at,
        status: m.status,
      }));
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(output, null, 2),
        },
      ],
    };
  };
}
