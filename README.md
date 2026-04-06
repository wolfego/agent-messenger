# agent-messenger

MCP server for AI agent-to-agent messaging. Lets Cursor and Claude Code agents send messages, reply in threads, and coordinate work — backed by [Beads](https://github.com/gastownhall/beads) for persistent, version-controlled storage.

## How It Works

Both agents connect to the same MCP server with different identities. Messages route via labels (`to:`, `from:`, `unread`) stored in a Beads (Dolt) database. Threading uses `replies_to` graph links. Channels isolate conversations when multiple agent pairs are active.

```
┌──────────────┐         ┌─────────────────────┐         ┌──────────────┐
│    Cursor     │◄─stdio─►│  agent-messenger MCP │◄─stdio─►│  Claude Code  │
│  --agent-id   │         │                     │         │  --agent-id   │
│   cursor      │         │  send_message       │         │   cc          │
│               │         │  check_inbox        │         │               │
│  #cm #sm #ch  │         │  reply              │         │  /cm /sm /ch  │
└──────────────┘         │  get_thread         │         └──────────────┘
                          │  set_channel        │
                          │  ...                │
                          │                     │
                          │  ┌───────────────┐  │
                          │  │ Beads (bd CLI) │  │
                          │  │ .beads/ Dolt DB│  │
                          │  └───────────────┘  │
                          └─────────────────────┘
```

## Quick Start

```bash
# Clone and build
git clone https://github.com/wolfego/agent-messenger.git
cd agent-messenger
npm install
npm run build

# Initialize Beads in your project
cd your-project
bd init --server
```

Add to your project's `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "agent-messenger": {
      "command": "node",
      "args": ["C:\\path\\to\\agent-messenger\\dist\\index.js", "--agent-id", "cursor"],
      "transport": "stdio"
    }
  }
}
```

Add to your project's `.mcp.json` (for Claude Code):
```json
{
  "mcpServers": {
    "agent-messenger": {
      "command": "node",
      "args": ["C:\\path\\to\\agent-messenger\\dist\\index.js", "--agent-id", "cc"],
      "transport": "stdio"
    }
  }
}
```

## Tools

| Tool | Description |
|---|---|
| `send_message` | Send a message to another agent |
| `check_inbox` | Check for unread messages |
| `reply` | Reply to a message (auto-threads) |
| `get_thread` | Get full conversation thread |
| `list_conversations` | List all conversations |
| `mark_read` | Mark a message as read |
| `set_channel` | Join a channel for multi-agent isolation |
| `whoami` | Show identity and current channel |

## Shortcuts

**Cursor** (via rules): `#cm` check messages, `#sm` send message, `#ch` set channel, `#wi` who am I

**Claude Code** (via slash commands): `/cm` `/sm` `/ch` `/wi`

## Multi-Agent Isolation

When multiple agent windows/terminals are open in the same project, use channels to prevent cross-talk:

```
[Cursor]  #ch design-review
[CC]      /ch design-review
```

Only agents on the same channel see each other's messages.

## Prerequisites

- Node.js 18+
- [Beads](https://github.com/gastownhall/beads) (`bd` CLI) v1.0.0+
- [Dolt](https://docs.dolthub.com/introduction/installation) v1.85.0+

## Docs

See [docs/setup-guide.md](docs/setup-guide.md) for detailed installation, configuration, workflow examples, and troubleshooting.

## License

MIT
