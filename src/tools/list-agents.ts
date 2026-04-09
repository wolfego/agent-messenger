import type { Config } from "../config.js";
import { listAgents } from "../beads.js";

export const listAgentsSchema = {};

export function handleListAgents(config: Config) {
  return () => {
    const agents = listAgents(config);

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
