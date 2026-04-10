import { z } from "zod";
import type { Config } from "../config.js";
import { projectStats } from "../tasks.js";

export const projectStatsSchema = {
  assigned_only: z.boolean().optional().describe("Show only issues assigned to current user (default: all)"),
  include_activity: z.boolean().optional().describe("Include recent 24h activity from git history (default: true)"),
};

export function handleProjectStats(config: Config) {
  return (args: { assigned_only?: boolean; include_activity?: boolean }) => {
    const stats = projectStats(config, args);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(stats, null, 2),
      }],
    };
  };
}
