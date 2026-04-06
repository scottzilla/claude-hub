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
│   └── claude-dispatch/          # Cost-tiered worker MCP (standalone)
│       ├── src/
│       ├── dist/
│       ├── .mcp.json
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

### linear-agent (bundled with scottclip)

The `linear-agent` MCP server is bundled inside the scottclip plugin at `plugins/scottclip/mcp/linear-agent/`. It's configured automatically by `/scottclip-init`. See the [scottclip README](./plugins/scottclip/README.md) for setup instructions.

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
