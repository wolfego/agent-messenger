#!/usr/bin/env node

import { argv, exit } from "node:process";
import { init } from "./init.js";
import { doctor } from "./doctor.js";
import { status } from "./status.js";

const command = argv[2];
const args = argv.slice(3);

function printUsage(): void {
  console.log(`
agent-messenger — AI agent-to-agent messaging via MCP + Beads

Usage:
  agent-messenger init     Set up agent-messenger in the current project
  agent-messenger doctor   Diagnose common setup issues
  agent-messenger status   Show message counts, recent activity, and agents
  agent-messenger help     Show this help message

Options for status:
  --beads-dir <path>  Path to .beads directory (default: auto-detect)

Options for init:
  --cursor-id <id>    Cursor agent ID (default: cursor-opus)
  --cc-id <id>        Claude Code agent ID (default: claude-code)
  --dry-run           Show what would be created without writing
  --skip-beads        Skip Beads/Dolt installation (use if already set up)
`);
}

async function main(): Promise<void> {
  switch (command) {
    case "init":
      await init(args);
      break;
    case "doctor":
      await doctor(args);
      break;
    case "status":
      await status(args);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      exit(1);
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err}`);
  exit(1);
});
