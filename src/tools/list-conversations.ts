import { z } from "zod";
import type { Config } from "../config.js";
import type { MessageStore } from "../message-store.js";

export const listConversationsSchema = {
  status: z.enum(["open", "closed", "all"]).optional().describe("Filter by status (default: all)"),
};

export function handleListConversations(config: Config, store?: MessageStore) {
  return (args: { status?: "open" | "closed" | "all" }) => {
    if (!store) {
      throw new Error("Message store not initialized — is .am/ directory accessible?");
    }

    const conversations = store.conversations(config.agentId, config.baseId, {
      status: args.status,
    });
    const formatted = conversations.map((c) => ({
      thread_id: c.thread_id,
      subject: c.subject,
      last_message: {
        id: c.last_message.id,
        from: c.last_message.from,
        timestamp: c.last_message.timestamp,
      },
      unread_count: c.unread_count,
      message_count: c.message_count,
    }));
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ conversations: formatted }, null, 2),
        },
      ],
    };
  };
}
