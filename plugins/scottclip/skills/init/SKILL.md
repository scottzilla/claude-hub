---
name: scottclip-init
description: This skill should be used when the user asks to "initialize scottclip", "set up scottclip", "scottclip init", "configure scottclip for this repo", or runs the /scottclip-init command. Scaffolds a repo with ScottClip config, persona directories, and Linear labels.
version: 0.1.0
---

# ScottClip Initialization

Initialize ScottClip in the current repository. This creates the `.scottclip/` directory with config, persona templates, and corresponding Linear labels.

## Prerequisites

Before starting, verify the Linear MCP is available:

1. Check that `mcp__claude_ai_Linear__list_teams` is callable
2. If not available, stop and instruct the user to connect Linear MCP first:
   - Add Linear MCP to `.mcp.json` or global MCP config
   - Restart Claude Code session
   - Re-run `/scottclip-init`

## Initialization Procedure

### Step 1: Gather Linear Context

1. Call `mcp__claude_ai_Linear__list_teams` to fetch available teams
2. Call `mcp__claude_ai_Linear__list_users` to identify the current user
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

1. Call `mcp__claude_ai_Linear__create_issue_label` to create the parent group label named after `labels.group` (default: "ScottClip")
2. Create child labels under this group:
   - One label per persona that has a non-null label (e.g., `backend`, `frontend`)

Use `mcp__claude_ai_Linear__list_issue_labels` first to check if labels already exist. Skip creation for any label that already exists.

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
   - Replace `{{TEAM}}` with the selected team name
   - Write to `.scottclip/`

3. Update `config.yaml` personas section to match the selected preset — remove entries for personas that weren't scaffolded.

### Step 5: Offer Schedule Setup

Ask the user if they want to set up a recurring heartbeat:

- **Yes** → Suggest: `/schedule 30m /heartbeat` and explain cadence options
- **Not now** → Explain they can run `/heartbeat` manually or set up `/schedule` later

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
```

## Error Handling

| Error | Response |
|-------|----------|
| Linear MCP not available | Stop. Print setup instructions for connecting Linear MCP. |
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
