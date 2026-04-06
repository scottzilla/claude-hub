---
name: scottclip-init
description: This skill should be used when the user asks to "initialize scottclip", "set up scottclip", "scottclip init", "configure scottclip for this repo", or runs the /scottclip-init command. Scaffolds a repo with ScottClip config, persona directories, and Linear labels.
version: 0.1.0
---

# ScottClip Initialization

Initialize ScottClip in the current repository. This creates the `.scottclip/` directory with config, persona templates, and corresponding Linear labels.

## Prerequisites

### Linear Agent MCP Server

ScottClip requires the `linear-agent` MCP server for OAuth `actor=app` authentication, which enables delegate-based locking and agent sessions.

#### Resume Detection

If `.mcp.json` exists and contains a `linear-agent` entry but the tools aren't available yet, the user likely needs to restart their Claude Code session. Report:

```
.mcp.json is configured with linear-agent, but the MCP tools aren't loaded yet.
Please restart your Claude Code session and re-run /scottclip-init to continue.
```

If `.scottclip/config.yaml` already exists AND `linear-agent` tools are available, this is a re-initialization — skip to the "Re-initialization" section at the bottom.

1. Check if `linear-agent` tools are available (any tool starting with `mcp__linear_agent__`).
2. If available, skip to the Initialization Procedure.
3. If not available, guide the user through setup:

#### Create a Linear OAuth App

1. Go to [linear.app/settings/api/applications](https://linear.app/settings/api/applications)
2. Click **New application**
3. Set the **Callback URL** to: `<LINEAR_CALLBACK_HOST>/oauth/callback` (e.g., `https://your-tunnel.trycloudflare.com/oauth/callback`)
4. After creation, note the **Client ID** and **Client Secret**
5. The authorization URL will include these query parameters:
   ```
   https://linear.app/oauth/authorize?
     client_id=YOUR_CLIENT_ID&
     redirect_uri=http://localhost:3847/oauth/callback&
     response_type=code&
     scope=read,write,app:assignable,app:mentionable&
     actor=app
   ```

#### Configure the MCP Server

Ask the user for:
- **LINEAR_CLIENT_ID** — from the OAuth app
- **LINEAR_CLIENT_SECRET** — from the OAuth app
- **LINEAR_WEBHOOK_SECRET** — a secret string for HMAC webhook validation (user can generate one, e.g., `openssl rand -hex 32`)
- **LINEAR_CALLBACK_HOST** — the public hostname for OAuth callback and webhooks (e.g., `https://your-tunnel.trycloudflare.com`). This must match the Callback URL registered on the Linear OAuth app. Default: `http://localhost:3847` (local development only).
- **AGENT_CWD** — the repo directory where Claude spawns on webhook events (pre-fill with the current working directory, let user edit if needed)

Then write the MCP configuration to `.mcp.json` in the repo root (create if it doesn't exist, merge if it does):

```json
{
  "mcpServers": {
    "linear-agent": {
      "command": "node",
      "args": ["<path-to-linear-agent>/dist/src/server.js"],
      "env": {
        "LINEAR_CLIENT_ID": "<client_id>",
        "LINEAR_CLIENT_SECRET": "<client_secret>",
        "LINEAR_WEBHOOK_SECRET": "<webhook_secret>",
        "LINEAR_CALLBACK_HOST": "<callback_host>",
        "AGENT_CWD": "<pre-filled-cwd>"
      }
    }
  }
}
```

The `<path-to-linear-agent>` should be resolved by checking:
1. If the user has `claude-hub` cloned locally, use that path (e.g., `~/code/claude-hub/mcps/linear-agent`)
2. Otherwise, ask the user where the `linear-agent` MCP server is installed

`AGENT_CWD` is pre-filled with the current working directory. Present it to the user for confirmation: "Agent working directory: `/current/path` — press Enter to accept or type a different path."

After writing `.mcp.json`, check if `linear-agent` tools are available:

- **If tools are available** (unlikely on first run — MCP servers load at session start): Continue to Step 1.
- **If tools are NOT available** (expected on first run): Report:
  ```
  ✓ .mcp.json configured with linear-agent MCP server

  ⚠ Claude Code needs to restart to load the new MCP server.
  
  Next steps:
    1. Restart your Claude Code session (Ctrl+C, then re-open)
    2. Re-run /scottclip-init — it will detect the config and resume from Step 1
  ```
  Then **stop** — do not continue with the rest of init. The user must restart first.

#### Set Up Webhook (Optional)

Ask the user if they want to set up webhook-driven events:

- **Yes** → Explain:
  1. Start the webhook receiver: `npm run webhook` (from the linear-agent directory)
  2. Expose it via tunnel: `cloudflared tunnel --url http://localhost:3847`
  3. Register the tunnel URL in Linear: Settings → API → Webhooks
     - **URL:** the tunnel URL
     - **Secret:** the same `LINEAR_WEBHOOK_SECRET` from above
     - **Events:** check `AgentSessionEvent`
  4. The `AGENT_CWD` env var in `.mcp.json` tells the webhook receiver where to spawn Claude sessions

- **Not now** → Explain they can set up webhooks later; ScottClip works fine with polling-only mode (`/heartbeat` or `/scottclip-watch --poll-only`)

## Initialization Procedure

### Step 1: Gather Linear Context

> **Resume point:** If the user just restarted after configuring `.mcp.json`, this is where init continues. The linear-agent MCP tools should now be available.

1. Call `linear_list_teams` to fetch available teams
2. Call `linear_list_users` to identify the current user
3. Present findings and ask the user to confirm:
   - Which **team** to use (if multiple teams exist)
   - Their **display name** for @-mentions in comments (pre-filled from Linear)
   - Their **board user name** for escalation @-mentions (pre-fill with same value as display name)

### Step 2: Choose Persona Preset

Ask the user which persona set to scaffold:

| Preset | Personas Created |
|--------|-----------------|
| **engineering** (default) | Orchestrator, CEO, Backend, Frontend |
| **full** | Orchestrator, CEO, Backend, Frontend, Infra, QA |
| **minimal** | Orchestrator, CEO only |
| **custom** | Orchestrator, CEO + user-specified personas |

For "custom", ask the user to name each persona and its Linear label.

### Step 3: Create Linear Labels

Create the ScottClip label group and persona labels in Linear:

1. Call `linear_create_label` to create the parent group label named after `labels.group` (default: "ScottClip")
2. Create child labels under this group:
   - One label per persona that has a non-null label (e.g., `backend`, `frontend`)

Use `linear_list_labels` first to check if labels already exist. Skip creation for any label that already exists.

**Important:** The Linear MCP's `create_issue_label` accepts `name`, `color`, and optionally `parentId` (for grouping under a parent label). Fetch the parent group label's ID after creating it, then pass it as `parentId` for child labels.

### Step 4: Scaffold Config & Personas

1. Create the directory structure:
   ```
   .scottclip/
   ├── config.yaml
   └── personas/
       ├── orchestrator/
       │   ├── SOUL.md
       │   ├── TOOLS.md
       │   └── config.yaml
       ├── ceo/
       │   ├── SOUL.md
       │   ├── TOOLS.md
       │   └── config.yaml
       ├── backend/          (if selected)
       │   ├── SOUL.md
       │   ├── TOOLS.md
       │   └── config.yaml
       └── frontend/         (if selected)
           ├── SOUL.md
           ├── TOOLS.md
           └── config.yaml
   ```

2. Copy templates from the plugin's `templates/` directory:
   - Read each template file from `${CLAUDE_PLUGIN_ROOT}/templates/`
   - Replace `{{USER_NAME}}` with the user's Linear display name
   - Replace `{{BOARD_USER}}` with the board user's name (from Step 1)
   - Replace `{{LINEAR_CLIENT_ID}}` with the OAuth client ID (from Prerequisites)
   - Replace `{{LINEAR_WEBHOOK_SECRET}}` with the webhook secret (from Prerequisites)
   - Replace `{{TEAM}}` with the selected team name
   - Write to `.scottclip/`

3. Update `config.yaml` personas section to match the selected preset — remove entries for personas that weren't scaffolded.

### Step 5: Offer Watch Mode Setup

Ask the user how they want to run ScottClip:

- **Watch mode (recommended)** → Suggest: `/scottclip-watch` for dual-mode operation (webhook + polling)
- **Polling only** → Suggest: `/scottclip-watch --poll-only` or `/schedule 30m /heartbeat`
- **Manual only** → Explain they can run `/heartbeat` when needed

### Step 6: Print Summary

Display what was created:

```
ScottClip initialized!

Linear labels created:
  ✓ ScottClip (group)
  ✓ backend
  ✓ frontend

Config: .scottclip/config.yaml
Personas:
  ✓ orchestrator → default (no label)
  ✓ ceo          → "ceo" label
  ✓ backend  → "backend" label
  ✓ frontend → "frontend" label

Next steps:
  1. Review .scottclip/config.yaml
  2. Customize persona SOUL.md files for your project
  3. Run /heartbeat or /schedule 30m /heartbeat

MCP configured: .mcp.json
  ✓ linear-agent server with OAuth credentials
  ✓ AGENT_CWD set to current directory
```

## Error Handling

| Error | Response |
|-------|----------|
| linear-agent MCP not available | Guide user through OAuth app creation and .mcp.json setup (see Prerequisites). |
| No teams found | Stop. Ask user to verify Linear workspace access. |
| Label creation fails | Log the error, continue with remaining labels, report at end. |
| `.scottclip/` already exists | Ask user: overwrite, merge, or cancel. Default to merge (skip existing files). |
| Template file missing from plugin | Log warning, create a minimal placeholder, continue. |

## Re-initialization

If `.scottclip/config.yaml` already exists:

1. Read the existing config version
2. Ask the user: **overwrite** (fresh start), **merge** (add missing personas only), or **cancel**
3. For merge: only create persona directories and labels that don't exist yet
4. For overwrite: back up existing config to `config.yaml.bak` before writing
