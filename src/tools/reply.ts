import { z } from "zod";
import type { Config } from "../config.js";
import { replyToMessage } from "../beads.js";

export const replySchema = {
  message_id: z.string().describe("The message ID being replied to"),
  body: z.string().describe("Reply content"),
  context_files: z.array(z.string()).optional().describe("Paths to files the recipient should read"),
  task_id: z.string().optional().describe("Link this reply to a Beads task ID (e.g. 'agent-messenger-z1b.1'). Adds a refs:<id> label and appends a summary to the task's notes."),
};

export function handleReply(config: Config) {
  return (args: { message_id: string; body: string; context_files?: string[]; task_id?: string }) => {
    const result = replyToMessage(config, {
      messageId: args.message_id,
      body: args.body,
      contextFiles: args.context_files,
      taskId: args.task_id,
    });

    const response: Record<string, unknown> = { message_id: result.id, status: "sent" };
    if (args.task_id) response["linked_task"] = args.task_id;

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  };
}
