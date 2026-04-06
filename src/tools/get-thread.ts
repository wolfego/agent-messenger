import { z } from "zod";
import type { Config } from "../config.js";
import { getThread } from "../beads.js";

export const getThreadSchema = {
  message_id: z.string().describe("Any message ID in the thread"),
};

export function handleGetThread(config: Config) {
  return (args: { message_id: string }) => {
    const messages = getThread(config, args.message_id);
    const formatted = messages.map((m) => ({
      id: m.id,
      from: m.labels?.find((l) => l.startsWith("from:"))?.slice(5) ?? m.created_by ?? "unknown",
      subject: m.title,
      body: m.description ?? "",
      timestamp: m.created_at,
    }));
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ messages: formatted }, null, 2),
        },
      ],
    };
  };
}
