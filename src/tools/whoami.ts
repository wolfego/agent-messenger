import type { Config } from "../config.js";

export function handleWhoami(config: Config) {
  return () => {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              agent_id: config.agentId,
              base_id: config.baseId,
              agent_name: config.agentName,
              channel: config.channel ?? null,
              project: config.projectRoot ?? null,
              beads_dir: config.beadsDir ?? null,
            },
            null,
            2
          ),
        },
      ],
    };
  };
}
