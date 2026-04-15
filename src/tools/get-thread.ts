import { z } from "zod";
import type { Config } from "../config.js";
import type { MessageStore } from "../message-store.js";

export const getThreadSchema = {
  message_id: z.string().describe("Any message ID in the thread"),
};

export function handleGetThread(_config: Config, store?: MessageStore) {
  return (args: { message_id: string }) => {
    if (!store) {
      throw new Error("Message store not initialized — is .am/ directory accessible?");
    }

    const messages = store.thread(args.message_id);
    const formatted = messages.map((m) => ({
      id: m.id,
      from: m.from,
      subject: m.subject,
      body: m.body,
      timestamp: m.timestamp,
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
