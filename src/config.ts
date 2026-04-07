import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

export interface Config {
  baseId: string;
  agentId: string;
  agentName: string;
  beadsDir?: string;
  channel?: string;
}

function generateSessionSuffix(): string {
  return randomBytes(2).toString("hex");
}

function formatName(id: string): string {
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function parseConfig(): Config {
  const args = process.argv.slice(2);
  let baseId = process.env["AGENT_MESSENGER_ID"] ?? "unknown";
  let beadsDir: string | undefined;
  let channel: string | undefined;
  let noAutoId = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent-id" && args[i + 1]) {
      baseId = args[i + 1]!;
      i++;
    } else if (args[i] === "--beads-dir" && args[i + 1]) {
      beadsDir = resolve(args[i + 1]!);
      i++;
    } else if (args[i] === "--channel" && args[i + 1]) {
      channel = args[i + 1]!;
      i++;
    } else if (args[i] === "--no-auto-id") {
      noAutoId = true;
    }
  }

  if (beadsDir && !beadsDir.endsWith(".beads")) {
    beadsDir = resolve(beadsDir, ".beads");
  }

  const suffix = noAutoId ? "" : `-${generateSessionSuffix()}`;
  const agentId = `${baseId}${suffix}`;
  const agentName = formatName(agentId);

  return { baseId, agentId, agentName, beadsDir, channel };
}
