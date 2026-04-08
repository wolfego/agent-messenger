import { z } from "zod";
import type { Config } from "../config.js";
import { registerPresence } from "../beads.js";

export const setIdentitySchema = {
  name: z.string().describe("New identity for this agent (e.g. 'cc-design', 'cc-auth'). This changes how you appear in messages and who can address you specifically."),
};

export function handleSetIdentity(config: Config) {
  return (args: { name: string }) => {
    const oldId = config.agentId;
    config.agentId = args.name;
    config.agentName = args.name
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    // Re-register presence with the new identity
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
              message: `Identity changed to '${config.agentId}'. Messages sent from you will now show from:${config.agentId}. You still receive messages addressed to '${config.baseId}' (your base ID) as well as '${config.agentId}'.`,
            },
            null,
            2
          ),
        },
      ],
    };
  };
}
