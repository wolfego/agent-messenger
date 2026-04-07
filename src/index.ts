import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseConfig } from "./config.js";
import { sendMessageSchema, handleSendMessage } from "./tools/send-message.js";
import { checkInboxSchema, handleCheckInbox } from "./tools/check-inbox.js";
import { replySchema, handleReply } from "./tools/reply.js";
import { getThreadSchema, handleGetThread } from "./tools/get-thread.js";
import { listConversationsSchema, handleListConversations } from "./tools/list-conversations.js";
import { markReadSchema, handleMarkRead } from "./tools/mark-read.js";
import { handleWhoami } from "./tools/whoami.js";
import { setChannelSchema, handleSetChannel } from "./tools/set-channel.js";
import { setIdentitySchema, handleSetIdentity } from "./tools/set-identity.js";

const config = parseConfig();

const server = new McpServer(
  { name: "agent-messenger", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions: `Agent messenger for inter-agent communication. You are ${config.agentId} (base: ${config.baseId})${config.channel ? ` on channel '${config.channel}'` : ""}. Use send_message to contact other agents, check_inbox to see messages addressed to you. If multiple agent pairs are active in this project, use set_channel to isolate conversations. Use set_identity to rename yourself (e.g. 'cc-design').`,
  }
);

server.tool(
  "send_message",
  "Send a message to another agent",
  sendMessageSchema,
  handleSendMessage(config)
);

server.tool(
  "check_inbox",
  "Check for messages addressed to this agent",
  checkInboxSchema,
  handleCheckInbox(config)
);

server.tool(
  "reply",
  "Reply to a specific message (auto-threads)",
  replySchema,
  handleReply(config)
);

server.tool(
  "get_thread",
  "Get a full conversation thread by any message ID in it",
  getThreadSchema,
  handleGetThread(config)
);

server.tool(
  "list_conversations",
  "List all conversations this agent is part of",
  listConversationsSchema,
  handleListConversations(config)
);

server.tool(
  "mark_read",
  "Mark a message as read",
  markReadSchema,
  handleMarkRead(config)
);

server.tool("whoami", "Get this agent's identity and current channel", handleWhoami(config));

server.tool(
  "set_channel",
  "Join a channel to isolate messages when multiple agent pairs are active. Both agents must join the same channel.",
  setChannelSchema,
  handleSetChannel(config)
);

server.tool(
  "set_identity",
  "Rename this agent (e.g. 'cc-design', 'cc-auth'). Useful when multiple instances of the same agent type are running. You still receive messages addressed to your base ID.",
  setIdentitySchema,
  handleSetIdentity(config)
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`agent-messenger MCP started (agent: ${config.agentId})\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
