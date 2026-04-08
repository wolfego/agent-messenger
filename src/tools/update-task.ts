import { z } from "zod";
import type { Config } from "../config.js";
import { updateTask } from "../tasks.js";

export const updateTaskSchema = {
  task_id: z.string().describe("Task ID to update"),
  status: z.string().optional().describe("New status: open, in_progress, blocked, closed"),
  title: z.string().optional().describe("New title"),
  description: z.string().optional().describe("New description (replaces existing)"),
  notes: z.string().optional().describe("Append notes (added to existing notes with newline)"),
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
