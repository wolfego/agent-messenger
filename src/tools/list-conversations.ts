import { z } from "zod";
import type { Config } from "../config.js";
import { listConversations } from "../beads.js";

export const listConversationsSchema = {
  status: z.enum(["open", "closed", "all"]).optional().describe("Filter by status (default: all)"),
};

export function handleListConversations(config: Config) {
  return (args: { status?: "open" | "closed" | "all" }) => {
    const conversations = listConversations(config, args.status ?? "all");
    const formatted = conversations.map((c) => ({
      thread_id: c.threadId,
      subject: c.subject,
      last_message: {
        id: c.lastMessage.id,
        from: c.lastMessage.labels?.find((l) => l.startsWith("from:"))?.slice(5) ?? "unknown",
        timestamp: c.lastMessage.created_at,
      },
      unread_count: c.unreadCount,
      message_count: c.messageCount,
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
