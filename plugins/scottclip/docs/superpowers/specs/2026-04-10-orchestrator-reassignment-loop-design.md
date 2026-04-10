# Orchestrator Reassignment Loop Design

**Date:** 2026-04-10
**Status:** Draft

---

## Problem

When a persona worker completes a pass and reassigns an issue to another role (e.g., CTO finishes review, hands off to Quant), the orchestrator does not spawn the next persona worker. The reassigned issue sits idle until a manual nudge or the next heartbeat poll.

Root cause: the orchestrator's "After all sub-agents return" section only checks for escalations and logs — it does not detect reassignment or spawn follow-up agents.

---

## Decision

Add a post-dispatch reassignment loop to the orchestrator agent. After each sub-agent completes, the orchestrator re-reads the issue state and decides whether to spawn the next persona worker. No changes to `webhook.ts` or `spawn.ts` — all logic lives in orchestrator markdown instructions.

---

## Requirements

### Detection

After a persona-worker sub-agent returns, the orchestrator must determine the outcome by re-fetching the issue from Linear and reading:

1. **Comment signal** — The reassignment comment template uses `**Status:** Reassigned → {role-name}`. Parse the latest ScottClip comment for this pattern. This is the primary signal.
2. **Label change** — Compare current issue labels against the persona label that was active when the sub-agent was spawned. A different persona label = reassignment.
3. **Sub-agent result text** — The sub-agent's return value may mention handoff or reassignment.
4. **Ambiguous case** — If no clear signal but the issue is not Done/Blocked, the orchestrator interprets context (latest comment content, issue description, work completed) and either picks the best persona or escalates to Board.

Detection priority: comment signal > label change > result text > orchestrator inference.

### Outcome Classification

| Outcome | Condition | Action |
|---------|-----------|--------|
| **Done** | Issue state = Done or In Review, no reassignment signal | Log, move on |
| **Reassigned** | Reassignment comment or label change to different persona | Spawn next persona worker |
| **Blocked** | Issue state = Blocked or explicit block signal in comment | Escalate to Board |
| **Ambiguous** | No clear signal, issue still in progress | Orchestrator interprets and decides (reassign or escalate) |

### Label Correction

If the sub-agent posted a reassignment comment naming a target role but did not update the label, the orchestrator must fix the label before spawning. Steps:

1. Parse target role from comment (`Reassigned → {role-name}`)
2. Validate role exists in `.scottclip/config.yaml` personas map
3. Read-modify-write labels: get current labels array, remove old persona label, add new persona label, save full set
4. If target role not found in config → escalate to Board instead of spawning

### Loop Mechanics

```
hop_count = 0
MAX_HOPS = 3

for each completed sub-agent:
  re-fetch issue (labels, state, latest comments)
  classify outcome
  
  if DONE or BLOCKED:
    break
  
  if REASSIGNED or AMBIGUOUS-resolved-to-reassign:
    hop_count += 1
    if hop_count >= MAX_HOPS:
      post comment: "Exceeded max reassignment hops (3). Escalating to Board."
      move issue to Blocked
      @-mention Board user
      break
    
    fix label if needed
    resolve new persona → read persona config
    spawn persona-worker sub-agent
    wait for completion
    loop back to re-fetch
```

### Hop Counter

- Tracked locally within a single orchestrator dispatch cycle (not persisted to Linear)
- Resets each time the orchestrator picks up the issue fresh (new heartbeat or new webhook trigger)
- The hop count is per-issue, not global
- MAX_HOPS = 3 (configurable in `.scottclip/config.yaml` if added later, hardcoded for now)

### Escalation on Max Hops

When hop limit reached:
1. Post comment using Blocked template with reason: "Issue has been reassigned 3 times in one dispatch cycle. This may indicate unclear ownership or scope."
2. Move issue to Blocked state
3. @-mention Board user (from `config.yaml` → `linear.user_name`)

---

## Changes Required

### 1. `orchestrator.md` — Expand dispatch loop

**Section: "After all sub-agents return" (currently lines 117-120)**

Replace with the reassignment loop logic. The orchestrator must:
- Re-fetch issue state after each sub-agent completes
- Classify the outcome (Done / Reassigned / Blocked / Ambiguous)
- Handle label correction
- Track hop count
- Spawn next persona worker or exit

**Section: "Dispatch" (lines 99-115)**

Add a note that dispatch is now a loop, not a one-shot. Each spawn cycles back through outcome detection.

### 2. `references/reassignment-detection.md` — New reference doc

Move detailed detection heuristics and examples out of `orchestrator.md` to keep it under word budget. Contents:
- Comment pattern matching (`**Status:** Reassigned → {role-name}`)
- Label diff detection
- Ambiguity resolution rules
- Examples of each outcome type

### 3. No changes to:

- `webhook.ts` — No new webhook handlers
- `spawn.ts` — No changes to SDK spawning
- `persona-worker` agents — They already post reassignment comments and change labels naturally
- `comment-format.md` — Reassignment template already exists and is sufficient

---

## Edge Cases

| Case | Handling |
|------|----------|
| Sub-agent crashes (no comment, no label change) | Issue stays in current state. Orchestrator classifies as Ambiguous → reads last known state, decides |
| Sub-agent reassigns to nonexistent role | Orchestrator validates role against config → escalate to Board |
| Sub-agent reassigns to same role | Counts as a hop. If it happens 3x, escalates (prevents infinite self-loops) |
| Multiple issues in same dispatch cycle | Each issue has independent hop counter |
| Sub-agent moves issue to Done but also changes label | Done state takes precedence — no reassignment |
| Issue state externally changed during sub-agent run | Orchestrator re-fetches, trusts current Linear state |

---

## Testing

Validation is manual (plugin is markdown, no unit tests for agent behavior):

1. **Happy path:** Worker posts reassignment comment with correct label → orchestrator spawns next worker
2. **Label correction:** Worker posts reassignment comment but wrong/missing label → orchestrator fixes label, spawns
3. **Max hops:** Three reassignments → orchestrator escalates with Blocked comment
4. **Ambiguous:** Worker finishes without clear signal → orchestrator reads context, makes decision
5. **Nonexistent role:** Worker names invalid role → orchestrator escalates to Board
