# scottzilla marketplace

A marketplace of Claude Code plugins and MCP servers for AI task delegation and tool integration.

## Plugins

| Plugin | Description |
|---|---|
| [`claude-dispatch`](./plugins/claude-dispatch/) | Routes tasks to Haiku, Sonnet, or Opus based on complexity |
| [`scottclip`](./plugins/scottclip/) | Linear-backed agent orchestration with persona-based task routing |

## How it works

Each plugin in this repo is installed independently. The `claude-dispatch` plugin gives the host Claude three worker agents, automatically routing tasks to the cheapest capable model tier.

```
Host Claude (Opus recommended)
  ├── Agent tool ──► quick-task   (Haiku  · read-only · max 15 turns)
  ├── Agent tool ──► code-worker  (Sonnet · read/write · max 30 turns)
  └── Agent tool ──► deep-thinker (Opus   · read/write · max 50 turns)
```

The host model handles routing decisions and conversation context. Workers handle the heavy lifting — reading files, generating code, doing research — on cheaper models. See [`plugins/claude-dispatch/CLAUDE.md`](./plugins/claude-dispatch/CLAUDE.md) for routing rules.

## Repo structure

```
.
├── .claude-plugin/
│   └── marketplace.json          # Catalog of all plugins in this repo
├── plugins/
│   └── claude-dispatch/          # Cost-tiered worker agents (agents-only)
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── agents/
│       │   ├── quick-task.md
│       │   ├── code-worker.md
│       │   └── deep-thinker.md
│       └── CLAUDE.md
├── mcps/
│   ├── claude-dispatch/          # Cost-tiered worker MCP (standalone)
│   │   ├── src/
│   │   ├── dist/
│   │   ├── .mcp.json
│   │   └── package.json
│   └── linear-agent/             # Linear API with agent features (actor=app)
│       ├── src/
│       │   ├── tools/            # 26 MCP tools
│       │   ├── auth.ts           # OAuth token manager
│       │   ├── graphql.ts        # Linear GraphQL client
│       │   └── server.ts         # MCP entry point
│       ├── webhook/
│       │   └── receiver.ts       # Webhook listener + Claude spawner
│       └── package.json
├── CLAUDE.md
├── README.md
└── .gitignore
```

## Installing a plugin

### Claude Code CLI

```bash
# Load a single plugin directly
claude --plugin-dir /path/to/this/repo/plugins/claude-dispatch

# Or add this repo as a marketplace and install from it
/plugin marketplace add scottzilla/claude-hub
/plugin install claude-dispatch@scottzilla
```

### Claude Desktop (Code tab)

No `--plugin-dir` equivalent in Desktop settings. Two options:

1. **CLI bridge** — Load with `claude --plugin-dir .../plugins/claude-dispatch`, then `/desktop` to move the session to Desktop.
2. **Marketplace install** — Add this repo as a marketplace in the Desktop UI: **+** → **Plugins** → **Add plugin** → enter the repo URL.

## MCP Servers

### claude-dispatch (optional)

The `mcps/claude-dispatch/` directory contains a standalone MCP server that exposes the same three tiers as text-only tools (`quick_task`, `code_task`, `deep_think`). This is separate from the plugin and requires an `ANTHROPIC_API_KEY` since it calls the Anthropic API directly.

Use this if you need the worker tiers in a context that only speaks MCP (e.g., Claude Desktop's Chat tab). To set up:

```bash
cd mcps/claude-dispatch
npm install
```

Then add to your `.mcp.json` or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "claude-dispatch": {
      "command": "node",
      "args": ["/absolute/path/to/mcps/claude-dispatch/dist/server.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

### linear-agent

Custom MCP server for Linear's API with `actor=app` OAuth authentication. Enables features the built-in Linear MCP doesn't support: delegate-based issue locking, agent sessions, agent activities, and webhook event consumption.

**26 tools** covering issues, comments, labels, teams, users, documents, agent sessions, issue relations, workflow states, and webhook events.

Primary consumer: [ScottClip](https://github.com/scottzilla/scottclip) (Linear-backed agent orchestration plugin).

#### Setup

1. Create a Linear OAuth app at [linear.app/settings/api/applications](https://linear.app/settings/api/applications) with scopes: `read`, `write`, `app:assignable`, `app:mentionable`. Set actor to `app`.

2. Install and build:
   ```bash
   cd mcps/linear-agent
   npm install
   npm run build
   ```

3. Add to your `.mcp.json`:
   ```json
   {
     "mcpServers": {
       "linear-agent": {
         "command": "node",
         "args": ["/absolute/path/to/mcps/linear-agent/dist/src/server.js"],
         "env": {
           "LINEAR_CLIENT_ID": "your_client_id",
           "LINEAR_CLIENT_SECRET": "your_client_secret"
         }
       }
     }
   }
   ```

#### Webhook receiver (optional)

For real-time Linear agent events (delegation, user messages in sessions):

```bash
# Start the receiver
LINEAR_WEBHOOK_SECRET=your_secret AGENT_CWD=/path/to/repo npm run webhook

# Expose via tunnel (separate terminal)
cloudflared tunnel --url http://localhost:3847
```

Register the tunnel URL as a webhook in Linear (Settings → API → Webhooks → `AgentSessionEvent`). The receiver validates HMAC signatures, acknowledges agent sessions within seconds, and spawns Claude Code sessions to do the work.

#### Tools

| Category | Tools |
|----------|-------|
| Issues | `save_issue`, `list_issues`, `get_issue` |
| Relations | `set_relation`, `remove_relation` |
| Comments | `list_comments`, `create_comment`, `delete_comment` |
| Labels | `list_labels`, `create_label` |
| Teams/Users | `list_teams`, `list_users`, `get_user`, `get_viewer` |
| Documents | `search_documents`, `get_document`, `list_documents`, `create_document`, `update_document`, `get_attachment` |
| Agent Sessions | `create_session`, `update_session`, `create_activity` |
| Events | `poll_events`, `get_webhook_status` |
| States | `list_states` |

All tool names are prefixed with `linear_` (e.g., `mcp__linear_agent__linear_save_issue`).

## Adding a new plugin

1. Create `plugins/<name>/` with a `.claude-plugin/plugin.json` manifest and your plugin files.
2. Add an entry to `.claude-plugin/marketplace.json` under `plugins`:
   ```json
   {
     "name": "<name>",
     "source": "./plugins/<name>",
     "description": "...",
     "version": "1.0.0",
     "category": "development"
   }
   ```
3. Update this README's plugin table.

See [`plugins/claude-dispatch/`](./plugins/claude-dispatch/) for a complete example.
