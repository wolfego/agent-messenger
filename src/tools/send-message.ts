import { z } from "zod";
import type { Config } from "../config.js";
import { createMessage } from "../beads.js";

export const sendMessageSchema = {
  to: z.string().describe("Target agent ID, e.g. 'claude-code' or 'cursor-opus'"),
  subject: z.string().describe("Short summary of the message"),
  body: z.string().describe("Full message content"),
  context_files: z.array(z.string()).optional().describe("Paths to files the recipient should read"),
  action: z.string().optional().describe("What the recipient should do: review, brainstorm, implement, reply"),
  priority: z.enum(["normal", "urgent"]).optional().describe("Message priority (default: normal)"),
};

export function handleSendMessage(config: Config) {
  return (args: {
    to: string;
    subject: string;
    body: string;
    context_files?: string[];
    action?: string;
    priority?: "normal" | "urgent";
  }) => {
    const result = createMessage(config, {
      to: args.to,
      subject: args.subject,
      body: args.body,
      contextFiles: args.context_files,
      action: args.action,
      priority: args.priority,
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
