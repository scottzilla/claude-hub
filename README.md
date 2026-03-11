# scottzilla marketplace

A marketplace of Claude Code plugins for cost-optimized AI task delegation.

## Plugins

| Plugin | Description |
|---|---|
| [`claude-dispatch`](./plugins/claude-dispatch/) | Routes tasks to Haiku, Sonnet, or Opus based on complexity |

## How it works

Each plugin in this repo is installed independently. The `claude-dispatch` plugin is the first entry — it gives the host Claude three worker agents and matching MCP tools, automatically routing tasks to the cheapest capable model tier.

```
Host Claude (Claude Code)
  ├── Agent tool ──► quick-task   (Haiku  · read-only · max 15 turns)
  ├── Agent tool ──► code-worker  (Sonnet · read/write · max 30 turns)
  ├── Agent tool ──► deep-thinker (Opus   · read/write · max 50 turns)
  └── MCP tools  ──► quick_task / code_task / deep_think (text-only API calls)
```

## Repo structure

```
.
├── .claude-plugin/
│   └── marketplace.json        # Catalog of all plugins in this repo
├── plugins/
│   └── claude-dispatch/         # First plugin — cost-tiered worker agents
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── agents/
│       │   ├── quick-task.md
│       │   ├── code-worker.md
│       │   └── deep-thinker.md
│       ├── src/
│       │   ├── server.ts
│       │   ├── workers.ts
│       │   └── call-model.ts
│       ├── .mcp.json
│       ├── CLAUDE.md
│       └── package.json
├── README.md
└── .gitignore
```

## Installing a plugin

### Claude Code CLI

```bash
# Load a single plugin directly
export ANTHROPIC_API_KEY=sk-ant-...
claude --plugin-dir /path/to/this/repo/plugins/claude-dispatch

# Or add this repo as a marketplace and install from it
/plugin marketplace add scottzilla/claude-dispatch
/plugin install claude-dispatch@scottzilla
```

### Claude Desktop (Code tab)

No `--plugin-dir` equivalent in Desktop settings. Two options:

1. **CLI bridge** — Load with `claude --plugin-dir .../plugins/claude-dispatch`, then `/desktop` to move the session to Desktop.
2. **Marketplace install** — Add this repo as a marketplace in the Desktop UI: **+** → **Plugins** → **Add plugin** → enter the repo URL.

## Adding a new plugin

1. Create `plugins/<name>/` with a `.claude-plugin/plugin.json` manifest and your plugin files.
2. Add an entry to `.claude-plugin/marketplace.json` under `plugins`:
   ```json
   {
     "name": "<name>",
     "source": "<name>",
     "description": "...",
     "version": "1.0.0",
     "category": "development"
   }
   ```
3. Update this README's plugin table.

See [`plugins/claude-dispatch/`](./plugins/claude-dispatch/) for a complete example with native agents + MCP server.
