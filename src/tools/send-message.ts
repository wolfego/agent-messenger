import { z } from "zod";
import type { Config } from "../config.js";
import { createMessage } from "../beads.js";

export const sendMessageSchema = {
  to: z.string().describe("Target agent ID — use base ID to reach any instance (e.g. 'claude-code'), or a specific session ID (e.g. 'cc-design') to target one instance"),
  subject: z.string().describe("Short summary of the message"),
  body: z.string().describe("Full message content"),
  context_files: z.array(z.string()).optional().describe("Paths to files the recipient should read"),
  action: z.string().optional().describe("What the recipient should do: review, brainstorm, implement, reply"),
  priority: z.enum(["normal", "urgent"]).optional().describe("Message priority (default: normal)"),
  worktree: z.string().optional().describe("Suggest the recipient use a git worktree with this name for isolation (e.g. 'add-tests'). The recipient's agent will present this as an option to the user, not execute automatically."),
};

const KNOWN_AGENTS = ["cursor-opus", "claude-code", "cursor", "cc"];

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
    });

    let warning: string | undefined;
    if (!KNOWN_AGENTS.includes(args.to)) {
      const suggestions = KNOWN_AGENTS.filter(a => a !== config.agentId);
      warning = `Unknown agent ID '${args.to}'. Known agents: ${suggestions.join(", ")}. Message sent anyway — the recipient won't see it unless their --agent-id matches '${args.to}'.`;
    }

    const response: Record<string, unknown> = { message_id: result.id, status: "sent" };
    if (args.worktree) response["worktree_suggested"] = args.worktree;
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
