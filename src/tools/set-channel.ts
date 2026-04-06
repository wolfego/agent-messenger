import { z } from "zod";
import type { Config } from "../config.js";

export const setChannelSchema = {
  channel: z.string().describe("Channel name to join (e.g. 'design-review', 'impl-auth'). Use the same channel on both agents to pair them. Set to empty string to clear."),
};

export function handleSetChannel(config: Config) {
  return (args: { channel: string }) => {
    if (args.channel === "") {
      config.channel = undefined;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ status: "ok", channel: null, message: "Channel cleared. You will see all messages addressed to you." }, null, 2),
          },
        ],
      };
    }

    config.channel = args.channel;
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "ok", channel: args.channel, message: `Joined channel '${args.channel}'. Only messages on this channel will appear in your inbox. The other agent must also join '${args.channel}'.` }, null, 2),
        },
      ],
    };
  };
}
