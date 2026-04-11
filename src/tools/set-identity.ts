import { z } from "zod";
import type { Config } from "../config.js";
import { deregisterPresence, registerPresence } from "../beads.js";

export const setIdentitySchema = {
  name: z.string().describe("New identity for this agent (e.g. 'cc-design', 'cc-auth'). This changes how you appear in messages and who can address you specifically."),
};

export function handleSetIdentity(config: Config) {
  return (args: { name: string }) => {
    const oldId = config.agentId;

    // Close the old presence record before changing identity
    if (config.beadsDir) {
      try { deregisterPresence(config); } catch { /* best-effort */ }
    }

    config.agentId = args.name;
    config.agentName = args.name
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    // Register presence with the new identity
    if (config.beadsDir) {
      try { registerPresence(config); } catch { /* best-effort */ }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              status: "ok",
              previous_id: oldId,
              agent_id: config.agentId,
              base_id: config.baseId,
            },
            null,
            2
          ),
        },
      ],
    };
  };
}
