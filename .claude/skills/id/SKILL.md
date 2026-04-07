---
name: id
description: Set agent identity. Use when the user says "/id" or asks to rename the agent.
---

Ask the user what name they'd like for this agent instance (suggest something descriptive like `cc-design`, `cc-auth`, `cc-review`). Then call the `set_identity` MCP tool with that name. Report back the new identity.
