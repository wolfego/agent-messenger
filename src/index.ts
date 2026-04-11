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
import { createTaskSchema, handleCreateTask } from "./tools/create-task.js";
import { createEpicSchema, handleCreateEpic } from "./tools/create-epic.js";
import { listTasksSchema, handleListTasks } from "./tools/list-tasks.js";
import { showTaskSchema, handleShowTask } from "./tools/show-task.js";
import { updateTaskSchema, handleUpdateTask } from "./tools/update-task.js";
import { claimTaskSchema, handleClaimTask } from "./tools/claim-task.js";
import { closeTaskSchema, handleCloseTask } from "./tools/close-task.js";
import { listAgentsSchema, handleListAgents } from "./tools/list-agents.js";
import { manageDepsSchema, handleManageDeps } from "./tools/manage-deps.js";
import { blockedTasksSchema, handleBlockedTasks } from "./tools/blocked-tasks.js";
import { projectStatsSchema, handleProjectStats } from "./tools/project-stats.js";
import { queryBeadsSchema, handleQueryBeads } from "./tools/query-beads.js";
import { cleanStalePresence, registerPresence, deregisterPresence } from "./beads.js";

const config = parseConfig();

const server = new McpServer(
  { name: "agent-messenger", version: "0.1.7" },
  {
    capabilities: { tools: {} },
    instructions: `Agent messenger for inter-agent communication. You are ${config.agentId} (base: ${config.baseId}, env: ${config.env})${config.channel ? ` on channel '${config.channel}'` : ""}. Use send_message to contact other agents, check_inbox to see messages addressed to you. If multiple agent pairs are active in this project, use set_channel to isolate conversations. On your FIRST turn in a new conversation, call set_identity with a short name reflecting your task (e.g. 'cc-web-ui', 'cc-auth-tests'). This helps other agents and the user identify you in list_agents.`,
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

server.tool(
  "create_task",
  "Create a new task in the Beads issue tracker",
  createTaskSchema,
  handleCreateTask(config)
);

server.tool(
  "create_epic",
  "Create a new epic for phased planning (groups related tasks under a parent)",
  createEpicSchema,
  handleCreateEpic(config)
);

server.tool(
  "list_tasks",
  "List tasks with optional filters (status, assignee, priority, ready-only)",
  listTasksSchema,
  handleListTasks(config)
);

server.tool(
  "show_task",
  "Show detailed information about a specific task",
  showTaskSchema,
  handleShowTask(config)
);

server.tool(
  "update_task",
  "Update a task's status, description, notes, labels, priority, or assignee",
  updateTaskSchema,
  handleUpdateTask(config)
);

server.tool(
  "claim_task",
  "Claim a task (atomically assigns to you and sets status to in_progress)",
  claimTaskSchema,
  handleClaimTask(config)
);

server.tool(
  "close_task",
  "Close a completed task, optionally showing newly unblocked tasks",
  closeTaskSchema,
  handleCloseTask(config)
);

server.tool(
  "list_agents",
  "List agents currently online in this project (based on presence records)",
  listAgentsSchema,
  handleListAgents(config)
);

server.tool(
  "manage_deps",
  "Add, remove, or list dependencies between tasks (blocks, tracks, related, parent-child, etc.)",
  manageDepsSchema,
  handleManageDeps(config)
);

server.tool(
  "blocked_tasks",
  "Show tasks that are blocked by unresolved dependencies (computed from dependency graph, not status label)",
  blockedTasksSchema,
  handleBlockedTasks(config)
);

server.tool(
  "project_stats",
  "Get project health snapshot: issue counts by state, ready work, lead time, recent activity",
  projectStatsSchema,
  handleProjectStats(config)
);

server.tool(
  "query_beads",
  "Query the Beads database. Use type 'message' to browse message history, or any other type for tasks/epics/chores. Convenience params (from, to, channel) translate to label filters automatically.",
  queryBeadsSchema,
  handleQueryBeads(config)
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const beadsInfo = config.beadsDir ? ` beads: ${config.beadsDir}` : " WARNING: no .beads/ found";
  process.stderr.write(`agent-messenger MCP started (agent: ${config.agentId}${beadsInfo})\n`);

  if (config.beadsDir) {
    // Defer presence registration to avoid blocking the event loop during
    // the MCP handshake. execFileSync in these functions would prevent the
    // transport from processing the client's initialize message, causing
    // a connection timeout in CC/Cursor.
    setTimeout(() => {
      try {
        cleanStalePresence(config);
        registerPresence(config);
        process.stderr.write(`  presence registered for ${config.agentId}\n`);
      } catch (err) {
        process.stderr.write(`  warning: presence registration failed: ${err}\n`);
      }
    }, 100);

    process.on("SIGINT", () => { deregisterPresence(config); process.exit(0); });
    process.on("SIGTERM", () => { deregisterPresence(config); process.exit(0); });
    process.on("exit", () => { deregisterPresence(config); });
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
