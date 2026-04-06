import { z } from "zod";
import type { Config } from "../config.js";
import { checkInbox } from "../beads.js";

export const checkInboxSchema = {
  include_read: z.boolean().optional().describe("Include already-read messages (default: false)"),
};

export function handleCheckInbox(config: Config) {
  return (args: { include_read?: boolean }) => {
    const messages = checkInbox(config, args.include_read ?? false);
    const formatted = messages.map((m) => ({
      id: m.id,
      from: m.labels?.find((l) => l.startsWith("from:"))?.slice(5) ?? "unknown",
      subject: m.title,
      body: m.description ?? "",
      context_files: extractContextFiles(m.description),
      action: m.labels?.find((l) => l.startsWith("action:"))?.slice(7),
      priority: m.priority === 0 ? "urgent" : "normal",
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

function extractContextFiles(description?: string): string[] {
  if (!description) return [];
  const match = description.match(/Context files:\n((?:- .+\n?)+)/);
  if (!match?.[1]) return [];
  return match[1]
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());
}
