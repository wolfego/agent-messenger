import { z } from "zod";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Config } from "../config.js";
import { WORKFLOW_TEMPLATES } from "../templates/workflows.js";

export const scaffoldWorkflowSchema = {
  name: z.string().describe(
    "Workflow name: 'orchestrate' or 'debug'. Determines which template is used."
  ),
  path: z.string().optional().describe(
    "Override the default path (docs/guidance/workflows/<name>.md). Rarely needed."
  ),
};

export function handleScaffoldWorkflow(config: Config) {
  return (args: { name: string; path?: string }) => {
    if (!config.projectRoot) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "error",
            message: "Cannot determine project root. Is .beads/ initialized?",
          }),
        }],
      };
    }

    const template = WORKFLOW_TEMPLATES[args.name];
    if (!template) {
      const available = Object.keys(WORKFLOW_TEMPLATES).join(", ");
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "error",
            message: `Unknown workflow '${args.name}'. Available: ${available}`,
          }),
        }],
      };
    }

    const targetPath = args.path
      ?? join(config.projectRoot, "docs", "guidance", "workflows", template.filename);

    if (existsSync(targetPath)) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "exists",
            path: targetPath,
            message: `Workflow doc already exists. Read it and follow the process defined within.`,
          }),
        }],
      };
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, template.content, "utf-8");

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "created",
          path: targetPath,
          message: `Created ${args.name} workflow doc. Read it end-to-end before proceeding. This is a living document — update it at session closeout with lessons learned.`,
        }),
      }],
    };
  };
}
