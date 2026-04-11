import { z } from "zod";
import type { Config } from "../config.js";
import { createMessage, listAgents } from "../beads.js";

export const sendMessageSchema = {
  to: z.string().describe("Target agent ID — use base ID to reach any instance (e.g. 'claude-code'), or a specific session ID (e.g. 'cc-design') to target one instance"),
  subject: z.string().describe("Short summary of the message"),
  body: z.string().describe("Full message content"),
  context_files: z.array(z.string()).optional().describe("Paths to files the recipient should read"),
  action: z.string().optional().describe("What the recipient should do: review, brainstorm, implement, reply"),
  priority: z.enum(["normal", "urgent"]).optional().describe("Message priority (default: normal)"),
  worktree: z.string().optional().describe("Suggest the recipient use a git worktree with this name for isolation (e.g. 'add-tests'). The recipient's agent will present this as an option to the user, not execute automatically."),
  task_id: z.string().optional().describe("Link this message to a Beads task ID (e.g. 'agent-messenger-z1b.1'). Adds a refs:<id> label for cross-referencing."),
};

const BASE_AGENTS = ["cursor-opus", "claude-code", "cursor", "cc"];

function getKnownAgents(config: Config): Set<string> {
  const known = new Set(BASE_AGENTS);
  try {
    for (const agent of listAgents(config)) {
      known.add(agent.agent_id);
      known.add(agent.base_id);
    }
  } catch { /* fall back to base list */ }
  return known;
}

function buildWorktreeSuggestion(name: string): string {
  return [
    "",
    "---",
    `**Worktree suggestion:** The sending agent suggested using a worktree named \`${name}\`.`,
    "Before proceeding, ask the user how they'd like to handle workspace isolation:",
    `1. Use a worktree: \`claude --worktree ${name}\``,
    "2. Stay on the current branch",
    "3. Create a regular feature branch",
  ].join("\n");
}

export function handleSendMessage(config: Config) {
  return (args: {
    to: string;
    subject: string;
    body: string;
    context_files?: string[];
    action?: string;
    priority?: "normal" | "urgent";
    worktree?: string;
    task_id?: string;
  }) => {
    let body = args.body;
    if (args.worktree) {
      body += buildWorktreeSuggestion(args.worktree);
    }

    const result = createMessage(config, {
      to: args.to,
      subject: args.subject,
      body,
      contextFiles: args.context_files,
      action: args.action,
      priority: args.priority,
      taskId: args.task_id,
    });

    let warning: string | undefined;
    const known = getKnownAgents(config);
    if (!known.has(args.to)) {
      const suggestions = [...known].filter(a => a !== config.agentId);
      warning = `No agent named '${args.to}' is currently online. Online agents: ${suggestions.join(", ")}. Message sent anyway — it will be delivered when an agent with that ID checks their inbox.`;
    }

    const response: Record<string, unknown> = { message_id: result.id, status: "sent" };
    if (args.worktree) response["worktree_suggested"] = args.worktree;
    if (args.task_id) response["linked_task"] = args.task_id;
    if (warning) response["warning"] = warning;

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
