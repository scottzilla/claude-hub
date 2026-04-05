---
name: persona-create
description: This skill should be used when the user asks to "create a persona", "add a new persona", "set up a new agent role", "add a scottclip persona", or runs the /persona-create command. Interactively creates a new ScottClip persona with SOUL.md, TOOLS.md, and config.yaml.
version: 0.1.0
---

# Create Persona

Interactively create a new ScottClip persona for this repository.

## Prerequisites

Verify `.scottclip/config.yaml` exists. If not, instruct the user to run `/scottclip-init` first.

## Procedure

### Step 1: Gather Persona Details

Ask the user for:

1. **Name** — Display name (e.g., "QA Engineer", "Infra Engineer", "Research Analyst")
2. **Role** — Role type: `engineer`, `orchestrator`, `analyst`, or custom
3. **Label** — Linear label for routing issues to this persona (e.g., `qa`, `infra`, `research`). Must be unique across existing personas.
4. **Escalates to** — Which persona to escalate to (default: `ceo`)
5. **Model** — Runtime model: `opus`, `sonnet`, or `haiku` (suggest based on role complexity)
6. **Required tools** — Beyond `mcp__claude_ai_Linear`, which tool prefixes does this persona need? (e.g., `mcp__neon`, `mcp__plugin_playwright_playwright`)

### Step 2: Generate SOUL.md

Create a SOUL.md tailored to the persona's role. Use the structure from existing persona templates:

- **Identity** — One-sentence role description
- **Technical Posture** — 5-7 principles for how this persona approaches work
- **Voice and Tone** — Communication style
- **Working Style** — How to approach tasks
- **Boundaries** — What this persona does NOT do (reference other personas)
- **Quality Checklist** — Pre-completion checks

Present the generated SOUL.md to the user for review. Ask if they want to edit any section.

### Step 3: Generate TOOLS.md

Create a TOOLS.md listing:
- Required tools (from step 1)
- Common usage patterns for this persona's role
- Optional tools the user might add later

### Step 4: Generate config.yaml

Create the persona's runtime config:

```yaml
name: <Name>
role: <role>
label: <label>
escalates_to: <escalates_to>

required_tools:
  - mcp__claude_ai_Linear
  # additional tools from step 1

runtime:
  model: <model>
  thinking_effort: <high for opus, medium for sonnet, low for haiku>
  max_turns: <300 for opus, 200 for sonnet, 100 for haiku>
  enable_chrome: false
  timeout: 0
  extra_args: []
```

### Step 5: Write Files

1. Create `.scottclip/personas/<label>/` directory
2. Write `SOUL.md`, `TOOLS.md`, `config.yaml`

### Step 6: Update Config

Read `.scottclip/config.yaml` and add the new persona to the `personas` map:

```yaml
<label>:
  path: "personas/<label>"
  label: "<label>"
```

> Only the Orchestrator should have `is_default: true`. Omit this field for all other personas.

### Step 7: Create Linear Label

Call `mcp__claude_ai_Linear__list_issue_labels` to check if the label exists. If not, create it under the ScottClip group via `mcp__claude_ai_Linear__create_issue_label`.

### Error Handling

| Error | Response |
|-------|----------|
| `.scottclip/config.yaml` missing | Stop. Instruct user to run `/scottclip-init` first. |
| Label already exists in Linear | Skip label creation, continue with file creation. |
| Persona directory already exists | Ask user: overwrite or cancel. Default to cancel. |
| Another persona has `is_default: true` | Warn user that only one persona should be default. Set new persona's `is_default` to false (omit field). |

### Step 8: Summary

```
Persona created: <Name>
  Label:    <label>
  Model:    <model>
  Escalates: <escalates_to>
  Path:     .scottclip/personas/<label>/

Files:
  ✓ SOUL.md
  ✓ TOOLS.md
  ✓ config.yaml

Linear label "<label>" created under ScottClip group.

Customize SOUL.md to match your project's specific needs.
```
