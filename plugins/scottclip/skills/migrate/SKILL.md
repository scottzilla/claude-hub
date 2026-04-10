---
name: scottclip-migrate
description: This skill should be used when the user asks to "migrate scottclip", "convert personas to roles", "upgrade scottclip config", or runs the /sc-migrate command. Converts existing persona directories to the role-based architecture.
version: 0.1.0
---

# ScottClip Migration

Convert an existing persona-based ScottClip installation (version 1) to the role-based architecture (version 2). This replaces three-file persona directories with single-file role descriptions and project-level agent definitions.

## Prerequisites

Before starting:

1. Verify `.scottclip/config.yaml` exists — stop with an error if not found.
2. Read `.scottclip/config.yaml` and check the `version` field:
   - If `version: 2` — report "Already migrated to version 2. Nothing to do." and stop.
   - If `version: 1` — proceed.
   - If no version field — treat as version 1 and proceed.
3. Verify `.scottclip/personas/` directory exists — stop with an error if not found.

## Step 1: Read Existing Config

Parse `.scottclip/config.yaml` in full. Extract:

- `user.name` — for `{{USER_NAME}}` placeholder replacement
- `user.team` — for `{{TEAM}}` placeholder replacement
- `personas:` map — to enumerate which personas exist

Keep the full parsed config in memory; you will rewrite it in Step 4.

## Step 2: Check for Existing Targets

Before writing any files, check whether the migration targets already exist:

- Check if `.scottclip/roles/` directory exists and contains any `.md` files
- Check if `.claude/agents/orchestrator.md` exists
- Check if `.claude/agents/worker.md` exists

If any exist, ask the user before proceeding:

```
The following already exist:
  - .scottclip/roles/ (N files)       [if applicable]
  - .claude/agents/orchestrator.md    [if applicable]
  - .claude/agents/worker.md          [if applicable]

Overwrite existing files? [y/n]
```

If the user answers no, stop.

## Step 3: Convert Personas to Roles

Create `.scottclip/roles/` if it does not exist.

For each entry in the `personas:` map from config.yaml:

1. **Skip orchestrator** — the orchestrator persona becomes a project-level agent definition (Step 4), not a role file. Skip any persona with `is_default: true` or named `orchestrator`.

2. **Read SOUL.md** — read `personas/{name}/SOUL.md`.

3. **Extract role content** — strip the following from SOUL.md before writing to the role file:
   - Any sections titled "Tools", "MCP Tools", "Available Tools", or similar tool-reference sections
   - Lines containing `mcp__` patterns (Linear MCP tool references)
   - References to TOOLS.md or instructions to "see TOOLS.md"
   - File path references to persona directories (e.g., `personas/backend/`)
   - Keep: identity statements, posture directives, domain boundaries, quality standards, completion criteria

4. **Write role file** — write the extracted content to `.scottclip/roles/{name}.md`.

Track each conversion for the summary output.

## Step 4: Scaffold Project-Level Agents

Create `.claude/agents/` if it does not exist.

1. **Copy orchestrator template:**
   - Read `${CLAUDE_PLUGIN_ROOT}/templates/agents/orchestrator.md`
   - Replace `{{USER_NAME}}` with the `user.name` value from config
   - Replace `{{TEAM}}` with the `user.team` value from config
   - Write to `.claude/agents/orchestrator.md`

2. **Copy worker template:**
   - Read `${CLAUDE_PLUGIN_ROOT}/templates/agents/worker.md`
   - Replace `{{USER_NAME}}` with the `user.name` value from config
   - Replace `{{TEAM}}` with the `user.team` value from config
   - Write to `.claude/agents/worker.md`

## Step 5: Update config.yaml

Rewrite `.scottclip/config.yaml` with two changes:

1. **Bump version:** Change `version: 1` to `version: 2`.

2. **Replace personas section with roles section.** Build the `roles:` section by mapping each non-orchestrator persona name to a role filename:

   ```yaml
   roles:
     directory: "roles"
     labels:
       backend: "backend.md"
       frontend: "frontend.md"
       ceo: "ceo.md"
   ```

   Include only the personas that were actually converted in Step 3. Omit orchestrator. Use the persona name (the key in the original `personas:` map) as the label key and `{name}.md` as the filename value.

3. **Preserve all other sections** — keep `user:`, `linear:`, `heartbeat:`, and any other top-level sections unchanged. Only replace `personas:` with `roles:` and update `version`.

Write the updated config back to `.scottclip/config.yaml`.

## Step 6: Print Summary

Print a complete summary of what was done:

```
Migration complete!

Converted:
  ✓ personas/backend/SOUL.md → roles/backend.md
  ✓ personas/frontend/SOUL.md → roles/frontend.md
  ✓ personas/ceo/SOUL.md → roles/ceo.md

Scaffolded:
  ✓ .claude/agents/orchestrator.md
  ✓ .claude/agents/worker.md

Config:
  ✓ .scottclip/config.yaml updated to version 2

Discarded (replaced by agent frontmatter + skills):
  ⚠ personas/*/TOOLS.md
  ⚠ personas/*/config.yaml

Old personas/ directory preserved (safe to delete after verification).

Next steps:
  1. Review role files in .scottclip/roles/
  2. Review agent definitions in .claude/agents/
  3. Run /sc-refresh-skills to generate project skills
  4. Delete .scottclip/personas/ when satisfied
```

Adjust the "Converted" list to reflect the actual personas that were processed. If any persona was skipped (e.g., no SOUL.md found), add a warning line:

```
  ⚠ personas/infra/SOUL.md — not found, skipped
```

## Error Handling

| Error | Response |
|-------|----------|
| `.scottclip/config.yaml` not found | "No .scottclip/config.yaml found. Run /sc-init first." Stop. |
| `version: 2` already in config | "Already migrated to version 2. Nothing to do." Stop. |
| `.scottclip/personas/` not found | "No personas/ directory found. Cannot migrate." Stop. |
| `personas/{name}/SOUL.md` not found | Log a warning for that persona, skip it, continue with others. |
| Template file missing | Log a warning with the expected path, skip that agent file, continue. |
| User declines overwrite prompt | "Migration cancelled." Stop. |
| Config write fails | Report the error. The personas/ directory is still intact — no data was lost. |
