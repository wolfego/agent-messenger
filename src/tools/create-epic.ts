import { z } from "zod";
import type { Config } from "../config.js";
import { createTask } from "../tasks.js";

export const createEpicSchema = {
  title: z.string().describe("Epic title (e.g. 'Epic 6.1: npm Publish')"),
  description: z.string().optional().describe("High-level description of the epic's goal and scope"),
  priority: z.string().optional().describe("Priority: P0 (critical) through P4 (low), or 0-4. Default: P2"),
  labels: z.array(z.string()).optional().describe("Labels to attach (e.g. ['phase:6', 'publish'])"),
  deps: z.array(z.string()).optional().describe("Dependency IDs this epic depends on"),
};

export function handleCreateEpic(config: Config) {
  return (args: {
    title: string;
    description?: string;
    priority?: string;
    labels?: string[];
    deps?: string[];
  }) => {
    const result = createTask(config, { ...args, type: "epic" });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              epic_id: result.id,
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
