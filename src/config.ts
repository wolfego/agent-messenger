import { resolve } from "node:path";

export interface Config {
  agentId: string;
  agentName: string;
  beadsDir?: string;
  channel?: string;
}

export function parseConfig(): Config {
  const args = process.argv.slice(2);
  let agentId = process.env["AGENT_MESSENGER_ID"] ?? "unknown";
  let beadsDir: string | undefined;
  let channel: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent-id" && args[i + 1]) {
      agentId = args[i + 1]!;
      i++;
    } else if (args[i] === "--beads-dir" && args[i + 1]) {
      beadsDir = resolve(args[i + 1]!);
      i++;
    } else if (args[i] === "--channel" && args[i + 1]) {
      channel = args[i + 1]!;
      i++;
    }
  }

  if (beadsDir && !beadsDir.endsWith(".beads")) {
    beadsDir = resolve(beadsDir, ".beads");
  }

  const agentName = agentId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return { agentId, agentName, beadsDir, channel };
}
