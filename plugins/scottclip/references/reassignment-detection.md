# Reassignment Detection

After a persona-worker sub-agent returns, the orchestrator must classify the outcome. This reference defines the detection heuristics.

## Detection Signals (Priority Order)

### 1. Sub-Agent Return Value (Primary)

The persona-worker returns a structured summary including `Final state`. Check this first:

| Return state | Outcome |
|-------------|---------|
| `Done` | **Done** — log and move on |
| `In Review` | **Check for reassignment** — may be human review OR another persona reviewing. Check comment + labels before deciding |
| `Blocked` | **Blocked** — escalate to Board |
| `Reassigned` | **Reassigned** — extract target role, spawn next persona |
| `In Progress` | **Ambiguous** — sub-agent may have hit turn limit without finishing |

### 2. Comment Signal (Confirmation)

Re-fetch issue comments via `mcp__linear-agent__linear_list_comments`. Parse the latest ScottClip comment for:

- `**Status:** Reassigned → {role-name}` — confirms reassignment and names the target role
- `**Status:** Completed` — confirms done
- `**Status:** Blocked` — confirms blocked

The comment is the source of truth for the **target role name** when reassigned.

### 3. Label State (Validation)

Re-fetch issue via `mcp__linear-agent__linear_get_issue`. Compare current labels against the persona label that was active when the sub-agent was spawned:

- **Different persona label** — sub-agent already swapped the label (good)
- **Same persona label** — sub-agent may have forgotten to swap (check comment for target role)
- **No persona label** — sub-agent removed label but didn't add new one (check comment)

## Outcome Classification

| Outcome | How to detect | Action |
|---------|--------------|--------|
| **Done** | Return state = Done, AND no reassignment signal in comments/labels | Log, exit loop for this issue |
| **In Review (check)** | Return state = In Review | Check comment + labels: if reassignment signal found → treat as Reassigned; if label unchanged and no handoff comment → exit loop (external/human review) |
| **Reassigned** | Return state = Reassigned, OR comment contains `Reassigned →` | Extract target role, fix label if needed, spawn next persona |
| **Blocked** | Return state = Blocked, OR issue state = Blocked | Escalate to Board, exit loop |
| **Ambiguous** | Return state = In Progress, no reassignment signal | Read latest comment + issue context, decide: if work seems incomplete and a handoff is implied, treat as reassignment; otherwise, leave issue in current state for next heartbeat |

## Label Correction

If the sub-agent posted a reassignment comment naming a target role but did NOT update the label:

1. Parse target role from comment: match `Reassigned → (\w+)` pattern
2. Validate role exists in `.scottclip/config.yaml` → `roles.labels`
3. If valid: read-modify-write labels (get current → remove old persona label → add new → save full set via `mcp__linear-agent__linear_save_issue`)
4. If invalid: escalate to Board — post comment: `⚠️ Reassignment target "{role-name}" not found in config. Escalating.`

## Examples

### Happy path — CTO reassigns to Quant

Sub-agent returns:
```
Issue: TRAA-43 — Implement rate limit handler
Final state: Reassigned
```

Latest comment:
```
**Status:** Reassigned → quant

### Handoff context
Rate limit logic implemented. Needs quant to validate the backoff parameters against historical data.
```

Labels: `quant` (sub-agent already swapped from `cto`)

→ Outcome: **Reassigned** to `quant`. Label correct. Spawn quant persona-worker.

### Label not updated

Sub-agent returns `Reassigned` but labels still show `cto`.
Comment says `Reassigned → quant`.

→ Orchestrator fixes label: remove `cto`, add `quant`, save. Then spawn.

### In Review with reassignment

Sub-agent returns `In Review`. Labels changed from `backend` to `cto`.
Comment says `Reassigned → cto` with handoff context about code review.

→ Outcome: **Reassigned** to `cto` (not human review — another persona is reviewing).

### Ambiguous — sub-agent hit turn limit

Sub-agent returns:
```
Final state: In Progress
```

No reassignment comment. Issue still has `backend` label.

→ Outcome: **Ambiguous**. Leave in current state. Next heartbeat will pick it up.
