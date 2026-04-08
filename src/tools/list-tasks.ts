import { z } from "zod";
import type { Config } from "../config.js";
import { listTasks } from "../tasks.js";

export const listTasksSchema = {
  status: z.string().optional().describe("Filter by status: open, in_progress, blocked, closed. Comma-separated for multiple"),
  assignee: z.string().optional().describe("Filter by assignee"),
  priority: z.string().optional().describe("Filter by priority (P0-P4 or 0-4)"),
  label: z.string().optional().describe("Filter by label (must have all specified, comma-separated)"),
  parent: z.string().optional().describe("Show children of this parent issue ID"),
  ready_only: z.boolean().optional().describe("Show only ready tasks (open, no blockers). Maps to 'bd ready'"),
  type: z.string().optional().describe("Issue type filter: task, bug, feature, epic, chore (default: task)"),
  limit: z.number().optional().describe("Max results to return (default: 50)"),
  sort: z.string().optional().describe("Sort by: priority, created, updated, status, title"),
};

export function handleListTasks(config: Config) {
  return (args: {
    status?: string;
    assignee?: string;
    priority?: string;
    label?: string;
    parent?: string;
    ready_only?: boolean;
    type?: string;
    limit?: number;
    sort?: string;
  }) => {
    const tasks = listTasks(config, args);

    const formatted = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      type: t.issue_type,
      assignee: t.owner ?? null,
      labels: t.labels ?? [],
    }));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ tasks: formatted, count: formatted.length }, null, 2),
        },
      ],
    };
  };
}
