---
name: persona-list
description: This skill should be used when the user asks to "list personas", "show personas", "what personas are configured", "show scottclip agents", or runs the /persona-list command. Lists all configured ScottClip personas with their runtime settings.
version: 0.1.0
---

# List Personas

Display all configured ScottClip personas for this repository.

## Procedure

### Step 1: Load Config

Read `.scottclip/config.yaml`. If missing, report that ScottClip is not initialized and suggest `/scottclip-init`.

### Step 2: Read Persona Details

For each persona in the `personas` config map:

1. Read `config.yaml` from the persona's path (`.scottclip/<persona.path>/config.yaml`)
2. Check if `SOUL.md` and `TOOLS.md` exist
3. If the persona directory does not exist at all, mark as `✗ MISSING` in the output
4. Collect: name, role, label, model, thinking effort, max turns, escalates_to, required tools

### Step 3: Format Output

```
ScottClip Personas
──────────────────
Name              Label       Model    Turns  Escalates  Tools
Orchestrator      (default)   haiku    50     ceo        Linear
CEO               ceo         sonnet   100    board      Linear
Backend Engineer  backend     opus     300    ceo        Linear
Frontend Engineer frontend    sonnet   200    ceo        Linear

Files:
  Orchestrator: .scottclip/personas/orchestrator/ ✓ SOUL ✓ TOOLS ✓ config
  CEO:          .scottclip/personas/ceo/         ✓ SOUL ✓ TOOLS ✓ config
  Backend:      .scottclip/personas/backend/     ✓ SOUL ✓ TOOLS ✓ config
  Frontend:     .scottclip/personas/frontend/    ✓ SOUL ✓ TOOLS ✓ config
```

Flag missing files with `✗` so the user knows what needs attention.

### Step 4: Suggest Actions

- If any persona has missing files → suggest `/persona-create` to recreate, or `/scottclip-init` with merge mode to restore from templates
- If a persona is in config but has no directory → suggest removing it from `config.yaml` or creating the directory via `/persona-create`
- Mention `/persona-create` for adding new personas
- Mention `/persona-import` for importing from Paperclip
