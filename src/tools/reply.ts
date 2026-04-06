import { z } from "zod";
import type { Config } from "../config.js";
import { replyToMessage } from "../beads.js";

export const replySchema = {
  message_id: z.string().describe("The message ID being replied to"),
  body: z.string().describe("Reply content"),
  context_files: z.array(z.string()).optional().describe("Paths to files the recipient should read"),
};

export function handleReply(config: Config) {
  return (args: { message_id: string; body: string; context_files?: string[] }) => {
    const result = replyToMessage(config, {
      messageId: args.message_id,
      body: args.body,
      contextFiles: args.context_files,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ message_id: result.id, status: "sent" }, null, 2),
        },
      ],
    };
  };
}
