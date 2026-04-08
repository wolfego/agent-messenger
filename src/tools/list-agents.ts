import { z } from "zod";
import type { Config } from "../config.js";
import { listAgents } from "../beads.js";

export const listAgentsSchema = {
  include_stale: z
    .boolean()
    .optional()
    .describe("Include agents whose presence record is older than 2 hours (default: false)"),
};

export function handleListAgents(config: Config) {
  return (args: { include_stale?: boolean }) => {
    const all = listAgents(config);
    const agents = args.include_stale ? all : all.filter((a) => !a.stale);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ agents, count: agents.length }, null, 2),
        },
      ],
    };
  };
}
