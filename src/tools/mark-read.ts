import { z } from "zod";
import type { Config } from "../config.js";
import type { MessageStore } from "../message-store.js";

export const markReadSchema = {
  message_id: z.string().describe("The message ID to mark as read"),
};

export function handleMarkRead(_config: Config, store?: MessageStore) {
  return (args: { message_id: string }) => {
    if (!store) {
      throw new Error("Message store not initialized — is .am/ directory accessible?");
    }

    store.markRead(args.message_id);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "ok" }, null, 2),
        },
      ],
    };
  };
}
