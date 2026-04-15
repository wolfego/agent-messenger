import { z } from "zod";
import type { Config } from "../config.js";
import type { MessageStore } from "../message-store.js";

export const checkInboxSchema = {
  include_read: z.boolean().optional().describe("Include already-read messages (default: false)"),
  auto_mark_read: z.boolean().optional().describe("Automatically mark fetched messages as read (default: true)"),
};

export function handleCheckInbox(config: Config, store?: MessageStore) {
  return (args: { include_read?: boolean; auto_mark_read?: boolean }) => {
    if (!store) {
      throw new Error("Message store not initialized — is .am/ directory accessible?");
    }

    const autoMark = args.auto_mark_read !== false;
    const messages = store.inbox(config.agentId, config.baseId, {
      channel: config.channel,
      includeRead: args.include_read,
    });

    const formatted = messages.map((m) => ({
      id: m.id,
      from: m.from,
      subject: m.subject,
      body: m.body,
      context_files: m.context_files.length > 0 ? m.context_files : extractContextFiles(m.body),
      action: m.action,
      priority: m.priority,
      timestamp: m.timestamp,
    }));

    if (autoMark) {
      const unreadIds = messages.filter((m) => m.unread).map((m) => m.id);
      if (unreadIds.length > 0) {
        store.markAllRead(unreadIds);
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            messages: formatted,
            auto_marked_read: autoMark ? formatted.length : 0,
          }, null, 2),
        },
      ],
    };
  };
}

function extractContextFiles(body: string): string[] {
  const match = body.match(/Context files:\n((?:- .+\n?)+)/);
  if (!match?.[1]) return [];
  return match[1]
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());
}
