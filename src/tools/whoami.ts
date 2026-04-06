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
              agent_name: config.agentName,
              channel: config.channel ?? null,
            },
            null,
            2
          ),
        },
      ],
    };
  };
}
