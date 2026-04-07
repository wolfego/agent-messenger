# agent-messenger

MCP server for AI agent-to-agent messaging. Lets Cursor and Claude Code agents send messages, reply in threads, and coordinate work — backed by [Beads](https://github.com/gastownhall/beads) for persistent, version-controlled storage.

## Quick Start

**Prerequisites:** [Node.js 18+](https://nodejs.org), [Beads (`bd` CLI)](https://github.com/gastownhall/beads/releases) v1.0.0+, [Dolt](https://docs.dolthub.com/introduction/installation) v1.85.0+

```bash
# Install
npm install -g agent-messenger

# Set up in your project
cd your-project
agent-messenger init

# Restart Cursor. Done.
```

That's it. The `init` command handles Beads initialization, MCP config generation, Cursor rules, and Claude Code skills. If something doesn't work, run:

```bash
agent-messenger doctor
```

## How It Works

Both agents connect to the same MCP server with different identities. Messages route via labels (`to:`, `from:`, `unread`) stored in a Beads (Dolt) database. Threading uses `replies_to` graph links. Channels isolate conversations when multiple agent pairs are active.

```
┌──────────────┐         ┌─────────────────────┐         ┌──────────────┐
│    Cursor     │◄─stdio─►│  agent-messenger MCP │◄─stdio─►│  Claude Code  │
│  cursor-opus  │         │                     │         │  claude-code  │
│               │         │  send_message       │         │               │
│  #cm #sm #ch  │         │  check_inbox        │         │  /cm /sm /ch  │
└──────────────┘         │  reply / get_thread  │         └──────────────┘
                          │  set_channel / ...   │
                          │                     │
                          │  ┌───────────────┐  │
                          │  │ Beads (bd CLI) │  │
                          │  │ .beads/ Dolt DB│  │
                          │  └───────────────┘  │
                          └─────────────────────┘
```

## Tools

| Tool                 | Description                              |
| -------------------- | ---------------------------------------- |
| `send_message`       | Send a message to another agent          |
| `check_inbox`        | Check for unread messages                |
| `reply`              | Reply to a message (auto-threads)        |
| `get_thread`         | Get full conversation thread             |
| `list_conversations` | List all conversations                   |
| `mark_read`          | Mark a message as read                   |
| `set_channel`        | Join a channel for multi-agent isolation |
| `whoami`             | Show identity and current channel        |

## Shortcuts

**Cursor** (via rules): `#cm` check messages, `#sm` send message, `#ch` set channel, `#wi` who am I

**Claude Code** (via skills): `/cm` `/sm` `/ch` `/wi`

## Multi-Agent Isolation

When multiple agent windows/terminals are open in the same project, use channels to prevent cross-talk:

```
[Cursor]  #ch design-review
[CC]      /ch design-review
```

Only agents on the same channel see each other's messages.

## CLI Commands

| Command                  | Description                               |
| ------------------------ | ----------------------------------------- |
| `agent-messenger init`   | Set up agent-messenger in current project |
| `agent-messenger doctor` | Diagnose common setup issues              |
| `agent-messenger help`   | Show help                                 |

### Init options

| Flag               | Default        | Description                       |
| ------------------ | -------------- | --------------------------------- |
| `--cursor-id <id>` | `cursor-opus`  | Cursor agent ID                   |
| `--cc-id <id>`     | `claude-code`  | Claude Code agent ID              |
| `--dry-run`        |                | Preview changes without writing   |
| `--skip-beads`     |                | Skip Beads/Dolt setup             |

## Manual Setup

If you prefer to set things up manually (or the installer doesn't cover your setup), see [docs/setup-guide.md](docs/setup-guide.md).

## License

MIT
