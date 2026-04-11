import { z } from "zod";
import type { Config } from "../config.js";
import { queryBeads } from "../beads.js";

export const queryBeadsSchema = {
  type: z.enum(["message", "task", "bug", "feature", "epic", "chore"]).describe("Beads record type to query"),
  from: z.string().optional().describe("Filter by sender agent ID (convenience — adds from:<id> label)"),
  to: z.string().optional().describe("Filter by recipient agent ID (convenience — adds to:<id> label)"),
  channel: z.string().optional().describe("Filter by channel (convenience — adds channel:<name> label)"),
  labels: z.array(z.string()).optional().describe("Raw label filters (AND logic). Use for advanced queries, e.g. ['kind:presence', 'agent:cc-debug']"),
  status: z.enum(["open", "closed", "all"]).optional().describe("Filter by status (default: open)"),
  limit: z.number().optional().describe("Max results to return (default: 20)"),
  sort: z.enum(["created", "updated", "priority"]).optional().describe("Sort field (default: created)"),
  reverse: z.boolean().optional().describe("Reverse sort order — newest first (default: true)"),
};

export function handleQueryBeads(config: Config) {
  return (args: {
    type: string;
    from?: string;
    to?: string;
    channel?: string;
    labels?: string[];
    status?: string;
    limit?: number;
    sort?: string;
    reverse?: boolean;
  }) => {
    const labels: string[] = [...(args.labels ?? [])];
    if (args.from) labels.push(`from:${args.from}`);
    if (args.to) labels.push(`to:${args.to}`);
    if (args.channel) labels.push(`channel:${args.channel}`);

    const results = queryBeads(config, {
      type: args.type,
      labels: labels.length > 0 ? labels : undefined,
      status: args.status ?? "open",
      limit: args.limit ?? 20,
      sort: args.sort ?? "created",
      reverse: args.reverse !== false,
    });

    const formatted = results.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.issue_type,
      status: r.status,
      priority: r.priority,
      from: r.labels?.find((l) => l.startsWith("from:"))?.slice(5),
      to: r.labels?.find((l) => l.startsWith("to:"))?.slice(3),
      channel: r.labels?.find((l) => l.startsWith("channel:"))?.slice(8),
      labels: r.labels?.filter((l) =>
        !l.startsWith("from:") && !l.startsWith("to:") && !l.startsWith("channel:")
      ),
      body: r.description ? truncate(r.description, 500) : undefined,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ count: formatted.length, results: formatted }, null, 2),
        },
      ],
    };
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}
