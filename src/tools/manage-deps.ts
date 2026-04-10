import { z } from "zod";
import type { Config } from "../config.js";
import { addDep, removeDep, listDeps } from "../tasks.js";

const DEP_TYPES = [
  "blocks",
  "tracks",
  "related",
  "parent-child",
  "discovered-from",
  "until",
  "caused-by",
  "validates",
  "relates-to",
  "supersedes",
] as const;

export const manageDepsSchema = {
  action: z.enum(["add", "remove", "list"]).describe("Action: add a dependency, remove one, or list deps/dependents"),
  issue_id: z.string().describe("The issue ID to operate on"),
  depends_on: z.string().optional().describe("Target issue ID (required for add/remove). For 'add': issue_id depends on this. For 'remove': removes this dependency."),
  type: z.string().optional().describe(`Dependency type for 'add' (default: blocks). Options: ${DEP_TYPES.join(", ")}`),
  direction: z.enum(["up", "down"]).optional().describe("For 'list': 'down' = what this depends on (default), 'up' = what depends on this"),
};

export function handleManageDeps(config: Config) {
  return (args: {
    action: "add" | "remove" | "list";
    issue_id: string;
    depends_on?: string;
    type?: string;
    direction?: "up" | "down";
  }) => {
    if (args.action === "add") {
      if (!args.depends_on) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "depends_on is required for 'add'" }) }],
          isError: true,
        };
      }
      addDep(config, { issue_id: args.issue_id, depends_on: args.depends_on, type: args.type });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            added: true,
            issue_id: args.issue_id,
            depends_on: args.depends_on,
            type: args.type ?? "blocks",
          }, null, 2),
        }],
      };
    }

    if (args.action === "remove") {
      if (!args.depends_on) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "depends_on is required for 'remove'" }) }],
          isError: true,
        };
      }
      removeDep(config, { issue_id: args.issue_id, depends_on: args.depends_on });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            removed: true,
            issue_id: args.issue_id,
            depends_on: args.depends_on,
          }, null, 2),
        }],
      };
    }

    // list
    const deps = listDeps(config, {
      issue_id: args.issue_id,
      direction: args.direction,
      type: args.type,
    });
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          issue_id: args.issue_id,
          direction: args.direction ?? "down",
          dependencies: deps,
          count: deps.length,
        }, null, 2),
      }],
    };
  };
}
