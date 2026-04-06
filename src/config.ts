import { resolve } from "node:path";

export interface Config {
  agentId: string;
  agentName: string;
  beadsDir?: string;
}

export function parseConfig(): Config {
  const args = process.argv.slice(2);
  let agentId = "unknown";
  let beadsDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent-id" && args[i + 1]) {
      agentId = args[i + 1]!;
      i++;
    } else if (args[i] === "--beads-dir" && args[i + 1]) {
      beadsDir = resolve(args[i + 1]!);
      i++;
    }
  }

  const agentName = agentId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return { agentId, agentName, beadsDir };
}
