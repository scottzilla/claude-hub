# Parallel Sub-Agent Dispatch for ScottClip

**Date:** 2026-04-03
**Status:** Draft
**Author:** Scott + Claude

## Problem

ScottClip processes Linear issues sequentially — one persona, one issue, one heartbeat cycle. When multiple independent issues are ready, they queue behind each other. This limits throughput and wastes time when issues have no dependencies between them.

## Solution

The orchestrator spawns persona sub-agents via the Claude Code Agent tool to process multiple issues concurrently. Each sub-agent runs in an isolated git worktree, reads its persona identity at startup, does the work, updates Linear, and returns a summary.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Execution model | Sub-agents (not Claude Teams) | Personas don't need inter-agent communication. Lower token cost. Stable API (teams are experimental). |
| Agent definition | Single generic `persona-worker.md` | One file handles all personas. New personas work automatically. Matches existing dynamic resolution. |
| Context injection | Sub-agent reads SOUL.md + TOOLS.md at startup (C1) | Keeps orchestrator lean. Sub-agent is self-contained. |
| Linear state ownership | Sub-agent owns updates | Matches current heartbeat behavior. Enables true parallel execution without orchestrator bottleneck. |
| Git isolation | Always use worktrees | Prevents file conflicts between concurrent sub-agents. Consistent behavior whether dispatching 1 or N agents. |

## Architecture

### New component: `agents/persona-worker.md`

A plugin-level agent definition. Single file, used by all personas.

**Startup sequence:**
1. Read `$AGENT_HOME/SOUL.md` — adopt identity
2. Read `$AGENT_HOME/TOOLS.md` — follow tool constraints
3. Read `$AGENT_HOME/config.yaml` — respect `max_turns` as self-enforced turn budget
4. Work the assigned Linear issue (provided in spawn prompt)
5. Post heartbeat comment and update issue state per SOUL.md guidance
6. Return a summary to the orchestrator

**The sub-agent prompt receives:**
- `$AGENT_HOME` — path to the persona directory (e.g., `.scottclip/personas/backend`)
- `thinking_effort` — from persona config, included as instruction
- Issue context — identifier, title, description, recent comments

**The sub-agent does NOT control:**
- Its own model (set by orchestrator at spawn time)
- Worktree isolation (set by orchestrator at spawn time)

### Modified orchestrator dispatch flow

Today's heartbeat loop changes at steps 8-9. Instead of wearing a persona hat and doing work, the orchestrator dispatches sub-agents.

**New step 8 — Dispatch:**

```
Collect all ready issues (In Progress first, then Todo, up to max_issues_per_heartbeat)

For each issue:
  1. Resolve persona label → persona directory ($AGENT_HOME)
  2. Read $AGENT_HOME/config.yaml → extract model, thinking_effort
  3. Prepare Agent call:
       subagent_type = "persona-worker"
       model         = config.model
       isolation     = "worktree"
       prompt        = [see below]

Spawn ALL Agent calls in a single message (parallel execution)
```

**Spawn prompt template:**
```
$AGENT_HOME = .scottclip/personas/{persona_name}
Thinking effort: {config.thinking_effort}

Issue: {issue_id} - {issue_title}
Description: {issue_description}
Recent comments:
{formatted_comments}
```

**New step 9 — Collect results:**

After all sub-agents return:
1. Check for escalations (any sub-agent flagged a blocker or reassignment)
2. Log heartbeat summary (aggregate of all sub-agent outcomes)
3. Release the lockfile
4. Exit or continue to next cycle

No Linear updates needed at this step — each sub-agent already handled its own issue state.

### Worktree awareness

Each sub-agent runs in a git worktree created from the current branch. The worktree contains the full repo state, including ScottClip specs, plugin files, and any recent commits. Sub-agents should treat these as part of the repo — not as unexpected changes. If a sub-agent's work results in commits, it should include worktree-present files normally in merges and not be alarmed by docs/specs or plugin files it didn't author.

### Dispatch constraints

- **Max parallel sub-agents** = number of ready issues, bounded by `max_issues_per_heartbeat` from config.yaml
- **Multiple instances of the same persona** are allowed. Two backend issues spawn two backend sub-agents, each in its own worktree, reading the same SOUL/TOOLS.
- **Single issue** still spawns a sub-agent. The orchestrator never does persona work itself — it is purely a coordinator.

### Config.yaml read split

The persona's `config.yaml` is read by both the orchestrator and the sub-agent, for different purposes:

| Reader | Fields | Purpose |
|---|---|---|
| Orchestrator | `runtime.model`, `runtime.thinking_effort` | Spawn-time parameters for the Agent tool call |
| Sub-agent | `max_turns` | Self-enforced turn budget during execution |

## Changes to existing files

### Modified

- **`templates/personas/orchestrator/SOUL.md`** — Add dispatch instructions: collect ready issues, resolve personas, read configs, spawn sub-agents in parallel, collect results, handle escalations.
- **`templates/personas/orchestrator/TOOLS.md`** — Add Agent tool with `subagent_type`, `model`, `isolation` parameters. Guidance on constructing spawn prompts.
- **`skills/heartbeat/SKILL.md`** — Update steps 3, 8-11 to reflect batch collection and dispatch-and-collect instead of single-issue sequential processing.
- **`agents/orchestrator.md`** — Add Agent tool to frontmatter and dispatch section to agent body.
- **`references/label-conventions.md`** — Update concurrent writer note for parallel sub-agents.

### New

- **`agents/persona-worker.md`** — Generic sub-agent definition for all personas.

### Unchanged

- Persona SOUL.md / TOOLS.md / config.yaml — consumed as-is by sub-agents
- Plugin manifest (`plugin.json`)
- Commands, hooks
- Linear workflow states and label conventions (note: label-conventions.md gets a minor wording update, not a convention change)
- Persona authoring workflow (`/persona-create`)

## Scope boundaries

**In scope:**
- Orchestrator dispatch logic (parallel sub-agent spawning)
- Generic persona-worker agent definition
- Git worktree isolation for all sub-agents
- Heartbeat loop modifications (steps 3, 8-11)

**Out of scope:**
- Inter-persona communication (sub-agents don't talk to each other)
- Changes to persona authoring (SOUL/TOOLS/config schema unchanged)
- New Linear states or labels
- Claude Teams-based execution
- Nested dispatch (sub-agents spawning their own sub-agents)
