import { z } from "zod";
import type { Config } from "../config.js";
import { blockedTasks } from "../tasks.js";

export const blockedTasksSchema = {
  parent: z.string().optional().describe("Scope to descendants of this epic/parent ID"),
};

export function handleBlockedTasks(config: Config) {
  return (args: { parent?: string }) => {
    const tasks = blockedTasks(config, args);

    const formatted = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      type: t.issue_type,
      assignee: t.owner ?? null,
      blocked_by: (t.dependencies ?? [])
        .filter((d) => d.dependency_type === "blocks" && d.status !== "closed")
        .map((d) => ({ id: d.id, title: d.title, status: d.status })),
    }));

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ blocked: formatted, count: formatted.length }, null, 2),
      }],
    };
  };
}
