---
name: scottclip-init
description: This skill should be used when the user asks to "initialize scottclip", "set up scottclip", "scottclip init", "configure scottclip for this repo", or runs the /scottclip-init command. Scaffolds a repo with ScottClip config, role files, agent definitions, and Linear labels.
version: 0.4.0
---

# ScottClip Initialization

Initialize ScottClip in the current repository. Creates `.mcp.json` (project-level MCP server config), authorizes with Linear via OAuth, and scaffolds `.scottclip/` with config and role files, `.claude/agents/` with agent definitions, and Linear labels.

## Flow Overview

```
Phase 1 (first run):  Collect credentials → Write .mcp.json + .scottclip/.env → Start server → Browser auth → Restart
Phase 2 (after restart): Verify auth → Pick team → Choose roles → Create labels → Scaffold config + roles + agents → Generate skills → Done
```

Phase 1 and Phase 2 are both handled by `/scottclip-init`. The skill detects which phase to run based on current state.

## State Detection

Run these checks at the start to determine where to resume:

1. **`.scottclip/config.yaml` exists AND `.claude/agents/orchestrator.md` exists AND `linear-agent` tools available** → this is a re-initialization. Skip to the "Re-initialization" section at the bottom.

2. **`.mcp.json` has `linear-agent` entry AND tools are available** → Phase 1 is done. Jump to **Phase 2**.

3. **`.mcp.json` has `linear-agent` entry BUT tools NOT available** → config was written but session hasn't restarted. First check if the server is running:
   ```
   Run via Bash: curl -s http://localhost:3847/ 2>/dev/null
   ```
   - **Server responds** → report:
     ```
     .mcp.json is configured and the server is running on port 3847.
     Restart Claude Code and re-run /scottclip-init to complete setup.
     ```
   - **Server not running** → offer to restart it:
     ```
     The server is not running. Restart it with:
       cd <plugin_root>/mcp/linear-agent && nohup node dist/server.js > <agent_cwd>/.scottclip/server.log 2>&1 &
     Then restart Claude Code and re-run /scottclip-init.
     ```
   Stop.

4. **No `linear-agent` in `.mcp.json` (or no `.mcp.json`)** → Fresh start. Run **Phase 1**.

---

## Phase 1: Connect to Linear

### Step 1: Collect Credentials

Ask the user for all values in a single prompt. Do NOT split across multiple interactions. Do NOT add extra instructions or UI language beyond what is shown below.

> To connect ScottClip to Linear, I need a few things:
>
> If you haven't created a Linear OAuth app yet:
> 1. Go to linear.app/settings/api/applications
> 2. Click "New application"
> 3. Set the Callback URL to: `<your-tunnel-hostname>/oauth/callback`
> 4. Note the Client ID and Client Secret
>
> Please provide:
> - **Tunnel hostname** (e.g., `https://my-tunnel.trycloudflare.com`)
> - **Linear Client ID**
> - **Linear Client Secret**

### Step 2: Write `.mcp.json` and `.scottclip/.env`

Resolve the plugin root path (`${CLAUDE_PLUGIN_ROOT}`). The MCP server is bundled at `${CLAUDE_PLUGIN_ROOT}/mcp/linear-agent/`.

Always install dependencies and build the MCP server to ensure it's up to date:
```
Run via Bash: cd <resolved_plugin_root>/mcp/linear-agent && rm -rf dist && npm install && npm run build
```
This MUST succeed before proceeding — without it, the MCP server won't load after restart.

**Write project-level MCP config.** Read existing `.mcp.json` in the current working directory if present (merge, don't overwrite other MCP servers). Write or update the `linear-agent` entry using the `url` key (HTTP transport):

```json
{
  "mcpServers": {
    "linear-agent": {
      "type": "http",
      "url": "http://localhost:3847/mcp"
    }
  }
}
```

> **Important:** The config MUST be at `<project>/.mcp.json` (project scope), NOT `~/.claude/.mcp.json`. Claude Code only reads MCP configs from project-level `.mcp.json`, `~/.claude.json` (local scope), or `~/.claude/settings.json` (user scope). The path `~/.claude/.mcp.json` is NOT recognized.

**Write `.scottclip/.env`.** Create the `.scottclip/` directory if needed. Write credentials to `.scottclip/.env` (the server loads this file automatically):

```
LINEAR_CLIENT_ID=<client_id>
LINEAR_CLIENT_SECRET=<client_secret>
LINEAR_WEBHOOK_SECRET=
LINEAR_CALLBACK_HOST=<tunnel_hostname>
AGENT_CWD=<current_working_directory>
```

`LINEAR_WEBHOOK_SECRET` is left empty for now — it will be set in Phase 2 after registering the webhook in Linear.

`AGENT_CWD` is pre-filled with the current working directory. Present for confirmation:
```
Agent working directory: /current/path — press Enter to accept or type a different path:
```

### Step 3: Start Server and Authorize

The MCP tools won't be available until after a restart. But we can still authorize now by starting the consolidated server directly.

1. Create the `.scottclip` directory if it doesn't exist:
   ```
   Run via Bash: mkdir -p .scottclip
   ```

2. Check if the server is already running:
   ```
   Run via Bash: lsof -i :3847
   ```
   - **Port is in use** → server is already running. Skip to step 4 (authorization flow).
   - **Port is free** → proceed to start the server.

3. Start the server as a background process (visible in Claude Code status line):
   ```
   Run via Bash (background): cd <agent_cwd> && AGENT_CWD=<agent_cwd> node <resolved_plugin_root>/mcp/linear-agent/dist/server.js 2>&1 | tee .scottclip/server.log
   ```
   Use `run_in_background: true` on the Bash tool call so it appears as an active task in the status line.
   The server reads credentials from `.scottclip/.env` written in Step 2.

   Wait 2 seconds, then verify the server started:
   ```
   Run via Bash: lsof -i :3847
   ```
   - **Shows a listening process** → server is running. Report:
     ```
     ✓ Server running on port 3847
       MCP:     http://localhost:3847/mcp
       Webhook: http://localhost:3847/webhook
       OAuth:   http://localhost:3847/oauth/callback
     ```
   - **No process found** → report error and show the log tail:
     ```
     Run via Bash: tail -20 <agent_cwd>/.scottclip/server.log
     ```
     Stop and ask the user to resolve the issue before retrying.

4. **Check for existing token** — look for a valid token file:
   ```
   Run via Bash: cat <agent_cwd>/.scottclip/token.json 2>/dev/null
   ```
   - **Token file exists and contains `access_token`** → report "✓ Already authorized with Linear!" and skip to Prompt Restart.
   - **No token file or missing `access_token`** → proceed to step 5.

5. **Attempt client_credentials token** — try to fetch a token directly (no browser needed):
   ```
   Run via Bash: curl -s -X POST https://api.linear.app/oauth/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=client_credentials&client_id=<client_id>&client_secret=<client_secret>&actor=app"
   ```
   - **Response contains `access_token`** → save the token to `<agent_cwd>/.scottclip/token.json` (as `{"access_token":"...","expires_at":"..."}`, computing `expires_at` from `expires_in`). Report "✓ Authorized with Linear (client credentials)!" and skip to Prompt Restart.
   - **Error or `client_credentials` not supported** → proceed to step 6 (browser auth).

6. **Build the authorization URL** (browser fallback):
   ```
   https://linear.app/oauth/authorize?client_id=<client_id>&redirect_uri=<tunnel_hostname>/oauth/callback&response_type=code&scope=read,write,app:assignable,app:mentionable&actor=app
   ```

7. **Open the browser:**
   ```
   Run via Bash: open "<authorization_url>"
   ```
   Report: "Opening Linear authorization in your browser. Approve the app and return here."

8. **Poll for the token file** — check every 5 seconds for up to 90 seconds. The token is stored at `<agent_cwd>/.scottclip/token.json`:
   ```
   Run via Bash: cat <agent_cwd>/.scottclip/token.json 2>/dev/null
   ```
   Where `<agent_cwd>` is the AGENT_CWD value from Step 2 (the repo's working directory).
   - **Token file appears (contains `access_token`)** → report "✓ Authorized with Linear!"
   - **Timeout** → report the auth URL for manual retry. Explain the callback URL in Linear's OAuth app must match `<tunnel_hostname>/oauth/callback`.

### Step 4: Prompt Restart

```
✓ .mcp.json configured (project-level)
✓ .scottclip/.env written
✓ Authorized with Linear
✓ Server running in background on port 3847

Restart Claude Code to load the MCP server, then re-run /scottclip-init to complete setup.
```

The server is running in the background and will persist after restart.

Stop here. Phase 2 runs after restart.

---

## Phase 2: Set Up ScottClip

> Phase 2 starts when: project `.mcp.json` has `linear-agent` AND MCP tools are available.

### Step 1: Verify Authorization

Call `linear_get_viewer`. 
- **Success** → report "✓ Authorized as <app name>"
- **Failure** → re-run the authorization flow from Phase 1 Step 3.

### Step 2: Gather Linear Context

1. Call `linear_list_teams` to fetch available teams.
2. Call `linear_list_users` to identify workspace members.
3. Ask the user to confirm:
   - Which **team** to use (if multiple exist) — note both the team `name` and `id` from the response
   - Their **display name** for @-mentions in comments (pre-filled from Linear)
   - Their **board user name** for escalation @-mentions (pre-fill with same value as display name)

### Step 3: Choose Role Preset

Ask the user which role set to scaffold:

| Preset | Roles Created |
|--------|--------------|
| **engineering** (default) | Backend, Frontend, CEO |
| **full** | Backend, Frontend, CEO + user-specified roles |
| **minimal** | CEO only |
| **custom** | User-specified roles |

Note: Orchestrator is not a role — it is scaffolded as a project-level agent for all presets.

For "full" or "custom", ask the user to name each additional role and its Linear label.

### Step 4: Create Linear Labels

1. Call `linear_list_labels` to check for existing labels.
2. Call `linear_create_label` to create the parent group label (default: "ScottClip"). Skip if it already exists.
3. Create child labels under the group — one per role selected in Step 3 (e.g., `backend`, `frontend`, `ceo`). Pass the parent group's ID as `parentId`. Skip any that already exist.

### Step 5: Scaffold Config, Roles & Agents

1. Create the directory structure:
   ```
   .scottclip/
   ├── config.yaml
   └── roles/
       ├── backend.md        (if selected)
       ├── frontend.md       (if selected)
       └── ceo.md
   .claude/
   └── agents/
       ├── orchestrator.md
       └── worker.md
   ```

2. Copy role templates from `${CLAUDE_PLUGIN_ROOT}/templates/roles/` to `.scottclip/roles/` — one `.md` file per selected role. Copy agent templates from `${CLAUDE_PLUGIN_ROOT}/templates/agents/` to `.claude/agents/` — always copy both `orchestrator.md` and `worker.md`. Replace these placeholders in ALL copied files:
   - `{{USER_NAME}}` → user's Linear display name
   - `{{BOARD_USER}}` → board user name
   - `{{LINEAR_CLIENT_ID}}` → OAuth client ID
   - `{{TEAM}}` → selected team name
   - `{{TEAM_ID}}` → selected team's `id` from the `linear_list_teams` response
   - `{{AUTO_REACT}}` → `true` or `false` based on user's auto-react choice (see Step 6)

3. Update `config.yaml` roles section to match the selected preset — include only the roles that were scaffolded. Use the `roles:` key (not `personas:`):
   ```yaml
   roles:
     directory: "roles"
     labels:
       backend: "backend.md"
       frontend: "frontend.md"
       ceo: "ceo.md"
   ```

### Step 5b: Generate Project Skills

After scaffolding roles and agents, scan the codebase to generate project-specific skills:

1. Detect frameworks, test runners, linters, and directory structure — look at `package.json`, config files, `src/`, `test/`, `db/` directories, etc.
2. Read `CLAUDE.md` (if present) for project conventions.
3. Check existing `.scottclip/skills/` — only create a new skill when no suitable candidate exists.
4. Generate skills tailored to what the codebase contains. Examples:
   - vitest + `test/helpers/` → `testing-patterns` skill
   - Drizzle ORM + `db/migrations/` → `migration-patterns` skill
   - Express or Hono → `api-conventions` skill
5. Present the proposed skills to the user for review before writing:
   ```
   Detected skills to generate:
     + testing-patterns  — vitest with helpers in test/helpers/
     + api-conventions   — Express routes in src/routes/

   Generate these? [y/n/edit]
   ```
6. On approval, write skills to `.scottclip/skills/` and add them to the `skills:` frontmatter in `.claude/agents/worker.md`.

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

  3. Update `.scottclip/.env` — set `LINEAR_WEBHOOK_SECRET` to the value the user provided.

  4. Report:
     ```
     ✓ Webhook secret saved to .scottclip/.env
     
     Note: Restart the server to apply the updated credentials:
       cd <plugin_root>/mcp/linear-agent && npm run start
     Or use /scottclip-watch to start it.
     ```

  5. Ask about auto-react:
     ```
     Enable auto-react? When enabled, webhook events automatically trigger a heartbeat
     so ScottClip responds to new issues without waiting for the next poll cycle. [y/n]
     ```
     - **Yes** → set `{{AUTO_REACT}}` to `true`
     - **No** → set `{{AUTO_REACT}}` to `false`

  6. Suggest: `/scottclip-watch` to start the server (webhook + polling)

- **Not now** →
  Explain they can set up webhooks later. ScottClip works fine with polling-only mode (`/heartbeat` or `/scottclip-watch`).
  Set `{{AUTO_REACT}}` to `false` (auto-react requires a webhook).

### Step 7: Offer Watch Mode

Ask the user how they want to run ScottClip:

- **Watch mode (recommended)** → Suggest: `/scottclip-watch`
- **Manual only** → Explain they can run `/heartbeat` when needed

### Step 8: Print Summary

```
ScottClip initialized!

MCP:
  ✓ linear-agent configured in .mcp.json (url: http://localhost:3847/mcp)
  ✓ Credentials in .scottclip/.env
  ✓ Authorized as <app name>
  ✓ AGENT_CWD: /current/path

Linear labels:
  ✓ ScottClip (group)
  ✓ backend
  ✓ frontend
  ✓ ceo

Roles:
  ✓ ceo          → .scottclip/roles/ceo.md         ("ceo" label)
  ✓ backend      → .scottclip/roles/backend.md     ("backend" label)
  ✓ frontend     → .scottclip/roles/frontend.md    ("frontend" label)

Agents:
  ✓ orchestrator → .claude/agents/orchestrator.md
  ✓ worker       → .claude/agents/worker.md

Skills:
  ✓ testing-patterns   → .scottclip/skills/testing-patterns/
  ✓ api-conventions    → .scottclip/skills/api-conventions/
  (or: ⚠ No project skills generated)

Webhook:
  ✓ Registered (secret configured)    — or —    ⚠ Not configured (polling-only mode)

Config: .scottclip/config.yaml

Next steps:
  1. Review and customize role files in .scottclip/roles/
  2. Run /heartbeat --dry-run to test
  3. Run /scottclip-watch to start watching for issues
```

---

## Error Handling

| Error | Response |
|-------|----------|
| MCP tools not available | Check project `.mcp.json` state, guide through Phase 1 or prompt restart. |
| Authorization fails | Show auth URL for manual retry, check tunnel is running and callback URL matches. |
| Server won't start | Check port 3847 conflict, verify `.scottclip/.env` credentials are set. |
| No teams found | Stop. Ask user to verify Linear workspace access. |
| Label creation fails | Log error, continue with remaining labels, report at end. |
| `.scottclip/` already exists | Ask: overwrite, merge, or cancel (see Re-initialization). |
| Template file missing | Log warning, create minimal placeholder, continue. |

## Re-initialization

If `.scottclip/config.yaml` already exists AND `.claude/agents/orchestrator.md` exists:

1. Read the existing config version.
2. **Version 1 config** (`personas:` section present, no `roles:` section): Inform the user this is a version 1 config and recommend running `/scottclip-migrate` to convert it to the role-based architecture. Do not attempt to merge or overwrite automatically — migration is a separate, explicit step.
3. **Version 2 config** (`roles:` section present): Ask the user: **overwrite** (fresh start), **merge** (add missing roles only), or **cancel**.
4. For merge: only create role files and labels that don't exist yet; re-run Step 5b to refresh generated skills.
5. For overwrite: back up existing config to `config.yaml.bak` before writing.
