---
name: scottclip-init
description: This skill should be used when the user asks to "initialize scottclip", "set up scottclip", "scottclip init", "configure scottclip for this repo", or runs the /scottclip-init command. Scaffolds a repo with ScottClip config, persona directories, and Linear labels.
version: 0.2.0
---

# ScottClip Initialization

Initialize ScottClip in the current repository. Creates `.mcp.json` (MCP server config), authorizes with Linear via OAuth, and scaffolds `.scottclip/` with config, persona templates, and Linear labels.

## Flow Overview

```
Phase 1 (first run):  Collect credentials → Write .mcp.json → Start receiver → Browser auth → Restart
Phase 2 (after restart): Verify auth → Pick team → Choose personas → Create labels → Scaffold config → Done
```

Phase 1 and Phase 2 are both handled by `/scottclip-init`. The skill detects which phase to run based on current state.

## State Detection

Run these checks at the start to determine where to resume:

1. **`.scottclip/config.yaml` exists AND `linear-agent` tools available** → this is a re-initialization. Skip to the "Re-initialization" section at the bottom.

2. **`.mcp.json` has `linear-agent` entry AND tools are available** → Phase 1 is done. Jump to **Phase 2**.

3. **`.mcp.json` has `linear-agent` entry BUT tools NOT available** → `.mcp.json` was written but session hasn't restarted. Report:
   ```
   .mcp.json is configured but the MCP server isn't loaded yet.
   Restart Claude Code and re-run /scottclip-init.
   ```
   Stop.

4. **No `linear-agent` in `.mcp.json` (or no `.mcp.json`)** → Fresh start. Run **Phase 1**.

---

## Phase 1: Connect to Linear

### Step 1: Collect Credentials

Ask the user for these values, one at a time:

1. **Tunnel hostname** — the publicly accessible URL where the webhook receiver and OAuth callback will be reachable.
   ```
   Enter your tunnel hostname (e.g., https://my-tunnel.trycloudflare.com):
   ```
   This is the base URL for both the OAuth callback and Linear webhooks. The user should have a tunnel running (cloudflared, ngrok, Tailscale Funnel, etc.) or plan to set one up.

2. **Linear Client ID** — from the Linear OAuth app.
   ```
   If you haven't created a Linear OAuth app yet:
     1. Go to linear.app/settings/api/applications
     2. Click "New application"
     3. Set Callback URL to: <tunnel_hostname>/oauth/callback
     4. Note the Client ID and Client Secret

   Enter your Linear Client ID:
   ```

3. **Linear Client Secret** —
   ```
   Enter your Linear Client Secret:
   ```

### Step 2: Write `.mcp.json`

Resolve the plugin root path (`${CLAUDE_PLUGIN_ROOT}`). The MCP server is bundled at `${CLAUDE_PLUGIN_ROOT}/mcp/linear-agent/dist/src/server.js`.

Read existing `.mcp.json` if present (merge, don't overwrite other MCP servers). Write or update the `linear-agent` entry:

```json
{
  "mcpServers": {
    "linear-agent": {
      "command": "node",
      "args": ["<resolved_plugin_root>/mcp/linear-agent/dist/src/server.js"],
      "env": {
        "LINEAR_CLIENT_ID": "<client_id>",
        "LINEAR_CLIENT_SECRET": "<client_secret>",
        "LINEAR_WEBHOOK_SECRET": "",
        "LINEAR_CALLBACK_HOST": "<tunnel_hostname>",
        "AGENT_CWD": "<current_working_directory>"
      }
    }
  }
}
```

`LINEAR_WEBHOOK_SECRET` is left empty for now — it will be set in Phase 2 after registering the webhook in Linear.

`AGENT_CWD` is pre-filled with the current working directory. Present for confirmation:
```
Agent working directory: /current/path — press Enter to accept or type a different path:
```

### Step 3: Start Receiver and Authorize

The MCP tools won't be available until after a restart. But we can still authorize now by starting the receiver directly.

1. Check if the receiver is already running:
   ```
   Run via Bash: lsof -i :3847 | grep LISTEN
   ```

2. If not running, start it with the credentials we just collected:
   ```
   Run via Bash (background): cd <resolved_plugin_root>/mcp/linear-agent && LINEAR_CLIENT_ID=<client_id> LINEAR_CLIENT_SECRET=<client_secret> LINEAR_CALLBACK_HOST=<tunnel_hostname> npm run webhook
   ```
   Wait 2 seconds, verify it started with `lsof -i :3847`.

3. Build the authorization URL:
   ```
   https://linear.app/oauth/authorize?client_id=<client_id>&redirect_uri=<tunnel_hostname>/oauth/callback&response_type=code&scope=read,write,app:assignable,app:mentionable&actor=app
   ```

4. Open the browser:
   ```
   Run via Bash: open "<authorization_url>"
   ```
   Report: "Opening Linear authorization in your browser. Approve the app and return here."

5. Poll for the token file — check every 5 seconds for up to 90 seconds:
   ```
   Run via Bash: cat ~/.linear-agent/token.json 2>/dev/null
   ```
   - **Token file appears** → report "✓ Authorized with Linear!"
   - **Timeout** → report the auth URL for manual retry. Explain the callback URL in Linear must match `<tunnel_hostname>/oauth/callback`.

### Step 4: Prompt Restart

```
✓ .mcp.json configured
✓ Authorized with Linear

Restart Claude Code to load the MCP server, then re-run /scottclip-init to complete setup.
```

Stop here. Phase 2 runs after restart.

---

## Phase 2: Set Up ScottClip

> Phase 2 starts when: `.mcp.json` has `linear-agent` AND MCP tools are available.

### Step 1: Verify Authorization

Call `linear_get_viewer`. 
- **Success** → report "✓ Authorized as <app name>"
- **Failure** → re-run the authorization flow from Phase 1 Step 3.

### Step 2: Gather Linear Context

1. Call `linear_list_teams` to fetch available teams.
2. Call `linear_list_users` to identify workspace members.
3. Ask the user to confirm:
   - Which **team** to use (if multiple exist)
   - Their **display name** for @-mentions in comments (pre-filled from Linear)
   - Their **board user name** for escalation @-mentions (pre-fill with same value as display name)

### Step 3: Choose Persona Preset

Ask the user which persona set to scaffold:

| Preset | Personas Created |
|--------|-----------------|
| **engineering** (default) | Orchestrator, CEO, Backend, Frontend |
| **full** | Orchestrator, CEO, Backend, Frontend, Infra, QA |
| **minimal** | Orchestrator, CEO only |
| **custom** | Orchestrator, CEO + user-specified personas |

For "custom", ask the user to name each persona and its Linear label.

### Step 4: Create Linear Labels

1. Call `linear_list_labels` to check for existing labels.
2. Call `linear_create_label` to create the parent group label (default: "ScottClip"). Skip if it already exists.
3. Create child labels under the group — one per persona with a non-null label (e.g., `backend`, `frontend`). Pass the parent group's ID as `parentId`. Skip any that already exist.

### Step 5: Scaffold Config & Personas

1. Create the directory structure:
   ```
   .scottclip/
   ├── config.yaml
   └── personas/
       ├── orchestrator/
       │   ├── SOUL.md, TOOLS.md, config.yaml
       ├── ceo/
       │   ├── SOUL.md, TOOLS.md, config.yaml
       ├── backend/          (if selected)
       │   ├── SOUL.md, TOOLS.md, config.yaml
       └── frontend/         (if selected)
           ├── SOUL.md, TOOLS.md, config.yaml
   ```

2. Copy templates from `${CLAUDE_PLUGIN_ROOT}/templates/`:
   - Replace `{{USER_NAME}}` with the user's Linear display name
   - Replace `{{BOARD_USER}}` with the board user name
   - Replace `{{LINEAR_CLIENT_ID}}` with the OAuth client ID
   - Replace `{{TEAM}}` with the selected team name
   - Write to `.scottclip/`

3. Update `config.yaml` personas section to match the selected preset — remove entries for personas that weren't scaffolded.

### Step 6: Set Up Webhook (Optional)

Ask the user if they want to enable real-time event-driven mode:

- **Yes (recommended)** →

  1. Instruct the user to register a webhook in Linear:
     ```
     Register a webhook in Linear:
       1. Go to Settings → API → Webhooks → New webhook
       2. URL: <tunnel_hostname> (from Phase 1)
       3. Events: check "AgentSessionEvent"
       4. Save — Linear will generate a webhook secret
       5. Copy the webhook secret from the webhook details page
     ```

  2. Ask for the webhook secret:
     ```
     Paste the webhook secret from Linear:
     ```

  3. Update `.mcp.json` — set `LINEAR_WEBHOOK_SECRET` to the value the user provided.

  4. Report:
     ```
     ✓ Webhook secret saved to .mcp.json
     
     Note: Restart Claude Code to apply the updated .mcp.json,
     or start the receiver manually:
       cd <plugin_root>/mcp/linear-agent && npm run webhook
     ```

  5. Suggest: `/scottclip-watch` for dual-mode operation (webhook + polling)

- **Not now** →
  Explain they can set up webhooks later. ScottClip works fine with polling-only mode (`/heartbeat` or `/scottclip-watch --poll-only`).

### Step 7: Offer Watch Mode

Ask the user how they want to run ScottClip:

- **Watch mode (recommended)** → Suggest: `/scottclip-watch`
- **Polling only** → Suggest: `/scottclip-watch --poll-only` or `/schedule 30m /heartbeat`
- **Manual only** → Explain they can run `/heartbeat` when needed

### Step 8: Print Summary

```
ScottClip initialized!

MCP:
  ✓ linear-agent configured in .mcp.json
  ✓ Authorized as <app name>
  ✓ AGENT_CWD: /current/path

Linear labels:
  ✓ ScottClip (group)
  ✓ backend
  ✓ frontend

Personas:
  ✓ orchestrator → default (no label)
  ✓ ceo          → "ceo" label
  ✓ backend      → "backend" label
  ✓ frontend     → "frontend" label

Webhook:
  ✓ Registered (secret configured)    — or —    ⚠ Not configured (polling-only mode)

Config: .scottclip/config.yaml

Next steps:
  1. Review and customize persona SOUL.md files
  2. Run /heartbeat --dry-run to test
  3. Run /scottclip-watch to start watching for issues
```

---

## Error Handling

| Error | Response |
|-------|----------|
| MCP tools not available | Check `.mcp.json` state, guide through Phase 1 or prompt restart. |
| Authorization fails | Show auth URL for manual retry, check tunnel is running and callback URL matches. |
| Receiver won't start | Check port 3847 conflict, suggest `WEBHOOK_PORT` env var. |
| No teams found | Stop. Ask user to verify Linear workspace access. |
| Label creation fails | Log error, continue with remaining labels, report at end. |
| `.scottclip/` already exists | Ask: overwrite, merge, or cancel (see Re-initialization). |
| Template file missing | Log warning, create minimal placeholder, continue. |

## Re-initialization

If `.scottclip/config.yaml` already exists:

1. Read the existing config version
2. Ask the user: **overwrite** (fresh start), **merge** (add missing personas only), or **cancel**
3. For merge: only create persona directories and labels that don't exist yet
4. For overwrite: back up existing config to `config.yaml.bak` before writing
