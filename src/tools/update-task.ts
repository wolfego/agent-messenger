import { z } from "zod";
import type { Config } from "../config.js";
import { updateTask, closeTask, reopenTask, showTask } from "../tasks.js";

export const updateTaskSchema = {
  task_id: z.string().describe("Task ID to update"),
  status: z.string().optional().describe("New status: open, in_progress, blocked, closed. Setting 'closed' auto-routes to close with reason. Setting 'open' on a closed task auto-routes to reopen."),
  title: z.string().optional().describe("New title"),
  description: z.string().optional().describe("New description (replaces existing)"),
  notes: z.string().optional().describe("Append notes (added to existing notes with newline). Also used as reason when closing or reopening."),
  priority: z.string().optional().describe("New priority (P0-P4 or 0-4)"),
  assignee: z.string().optional().describe("New assignee"),
  add_labels: z.array(z.string()).optional().describe("Labels to add"),
  remove_labels: z.array(z.string()).optional().describe("Labels to remove"),
  due: z.string().optional().describe("Due date: +6h, +1d, tomorrow, 2025-01-15"),
  estimate: z.number().optional().describe("Time estimate in minutes"),
};

export function handleUpdateTask(config: Config) {
  return (args: {
    task_id: string;
    status?: string;
    title?: string;
    description?: string;
    notes?: string;
    priority?: string;
    assignee?: string;
    add_labels?: string[];
    remove_labels?: string[];
    due?: string;
    estimate?: number;
  }) => {
    // Smart routing: status transitions to close/reopen use dedicated commands
    // so Beads emits proper lifecycle events
    if (args.status === "closed") {
      const result = closeTask(config, { task_id: args.task_id, reason: args.notes });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(
            { task_id: result.id, title: result.title, status: result.status, closed: true },
            null, 2
          ),
        }],
      };
    }

    if (args.status === "open") {
      const current = showTask(config, { task_id: args.task_id });
      const task = Array.isArray(current) ? current[0]! : current;
      if (task.status === "closed") {
        const result = reopenTask(config, { task_id: args.task_id, reason: args.notes });
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(
              { task_id: result.id, title: result.title, status: result.status, reopened: true },
              null, 2
            ),
          }],
        };
      }
    }

    const result = updateTask(config, args);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              task_id: result.id,
              title: result.title,
              status: result.status,
              updated: true,
            },
            null,
            2
          ),
        },
      ],
    };
  };
}
