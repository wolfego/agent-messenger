import { z } from "zod";
import type { Config } from "../config.js";
import { markRead } from "../beads.js";

export const markReadSchema = {
  message_id: z.string().describe("The message ID to mark as read"),
};

export function handleMarkRead(config: Config) {
  return (args: { message_id: string }) => {
    markRead(config, args.message_id);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "ok" }, null, 2),
        },
      ],
    };
  };
}
