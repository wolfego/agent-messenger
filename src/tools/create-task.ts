import { z } from "zod";
import type { Config } from "../config.js";
import { createTask } from "../tasks.js";

export const createTaskSchema = {
  title: z.string().describe("Task title"),
  description: z.string().optional().describe("Detailed description of the task"),
  type: z.enum(["task", "bug", "feature", "epic", "chore"]).optional().describe("Issue type (default: task)"),
  priority: z.string().optional().describe("Priority: P0 (critical) through P4 (low), or 0-4. Default: P2"),
  labels: z.array(z.string()).optional().describe("Labels to attach (e.g. ['frontend', 'urgent'])"),
  parent: z.string().optional().describe("Parent issue ID to create as a subtask (e.g. 'agent-messenger-z1b')"),
  deps: z.array(z.string()).optional().describe("Dependency IDs this task depends on"),
  assignee: z.string().optional().describe("Who to assign the task to"),
  due: z.string().optional().describe("Due date: +6h, +1d, +2w, tomorrow, next monday, or 2025-01-15"),
  estimate: z.number().optional().describe("Time estimate in minutes (e.g. 60 for 1 hour)"),
  context: z.string().optional().describe("Additional context for the task"),
  design_file: z.string().optional().describe("Path to a design document file"),
};

export function handleCreateTask(config: Config) {
  return (args: {
    title: string;
    description?: string;
    type?: "task" | "bug" | "feature" | "epic" | "chore";
    priority?: string;
    labels?: string[];
    parent?: string;
    deps?: string[];
    assignee?: string;
    due?: string;
    estimate?: number;
    context?: string;
    design_file?: string;
  }) => {
    const result = createTask(config, args);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              task_id: result.id,
              title: result.title,
              status: result.status,
              priority: result.priority,
              type: result.issue_type,
            },
            null,
            2
          ),
        },
      ],
    };
  };
}
