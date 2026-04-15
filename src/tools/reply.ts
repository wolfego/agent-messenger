import { z } from "zod";
import type { Config } from "../config.js";
import type { MessageStore } from "../message-store.js";
import { appendTaskNote } from "../beads.js";

export const replySchema = {
  message_id: z.string().describe("The message ID being replied to"),
  body: z.string().describe("Reply content"),
  context_files: z.array(z.string()).optional().describe("Paths to files the recipient should read"),
  task_id: z.string().optional().describe("Link this reply to a Beads task ID (e.g. 'agent-messenger-z1b.1'). Adds a refs:<id> label and appends a summary to the task's notes."),
};

export function handleReply(config: Config, store?: MessageStore) {
  return (args: { message_id: string; body: string; context_files?: string[]; task_id?: string }) => {
    if (!store) {
      throw new Error("Message store not initialized — is .am/ directory accessible?");
    }

    const original = store.find(args.message_id);
    if (!original) {
      throw new Error(`Message ${args.message_id} not found`);
    }

    const originalFrom = original.from;
    const subject = original.subject.startsWith("Re: ") ? original.subject : `Re: ${original.subject}`;

    let body = args.body;
    if (args.context_files?.length) {
      body += "\n\n---\nContext files:\n" + args.context_files.map((f) => `- ${f}`).join("\n");
    }

    const meta = store.create({
      to: originalFrom,
      from: config.agentId,
      subject,
      body,
      channel: original.channel,
      context_files: args.context_files,
      task_id: args.task_id,
      reply_to: args.message_id,
      thread_id: original.thread_id,
    });

    if (args.task_id && config.beadsDir) {
      try {
        const summary = args.body.length > 200 ? args.body.slice(0, 197) + "..." : args.body;
        const note = `[${config.agentId} → ${originalFrom}] ${subject}: ${summary}`;
        appendTaskNote(config, args.task_id, note);
      } catch { /* best-effort */ }
    }

    const response: Record<string, unknown> = { message_id: meta.id, status: "sent" };
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
