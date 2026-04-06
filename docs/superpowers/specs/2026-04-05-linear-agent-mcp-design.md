# Linear Agent MCP Server — Design Spec

## Purpose

A custom MCP server that connects Claude Code to Linear's API with `actor=app` OAuth authentication, enabling Linear's agent delegation features (delegate field, agent sessions, agent activities) that the built-in Linear MCP cannot support.

Primary consumer: WoterClip (Claude Code plugin for Linear-backed agent orchestration).

## Problem

The built-in `mcp__claude_ai_Linear__*` MCP authenticates as a user, not as an OAuth app. Linear's agent features require `actor=app` authentication:

- **Delegate field** — sets agent as delegate (not assignee), human keeps ownership
- **Agent sessions** — lifecycle tracking with states, activities, and plans visible in Linear UI
- **Agent activities** — structured updates (thought, action, response, error) rendered natively
- **Webhook events** — `AgentSessionEvent` fires on mention or delegation

## Architecture

### Components

```
Claude Code Session
  └── linear-agent MCP (stdio subprocess)
        ├── GraphQL client → Linear API (HTTPS)
        ├── Token manager (client_credentials, 30-day tokens)
        └── Event poller → ~/.linear-agent/events/

Webhook Receiver (separate persistent process)
  └── Local HTTP server behind cloudflared tunnel
        ├── Validates Linear HMAC-SHA256 signatures
        └── Writes event JSON files → ~/.linear-agent/events/
```

Two processes, connected by a **file-based event queue**:

1. **linear-agent MCP server** — Stdio subprocess of Claude Code. Handles all Linear API calls via GraphQL. Manages OAuth tokens. Polls `~/.linear-agent/events/` for webhook-delivered events.

2. **Webhook receiver** — Separate persistent process. Small HTTP server (~60 lines) running behind `cloudflared tunnel` or `ngrok`. Receives POST from Linear, validates HMAC signature, writes event file. Always-on independent of Claude Code sessions.

### Why this split

MCP stdio processes are ephemeral — they start and stop with Claude Code sessions. Webhooks need a persistent listener. Mixing these in one process creates lifecycle problems (port conflicts, zombie listeners, missed events between sessions). The file-based queue cleanly decouples them.

### Why file-based queue

Zero dependencies. No database, no message broker, no IPC. The MCP server reads files; the webhook receiver writes files. For a single-user developer tool, this is the right abstraction. If scaling to multiple machines becomes necessary, swap the directory for an SQS queue — the interface (read event, delete event) stays identical.

## Authentication

### Token acquisition: `client_credentials` grant

```
MCP server startup
  → Read LINEAR_CLIENT_ID + LINEAR_CLIENT_SECRET from environment
  → POST https://api.linear.app/oauth/token
      grant_type=client_credentials
      client_id=...
      client_secret=...
      actor=app
  → Response: { access_token, expires_in (30 days) }
  → Cache to ~/.linear-agent/token.json (0600 permissions)
```

### Token refresh

Before each API call, check token expiry. If within 1 hour of expiration, re-run `client_credentials` grant. No refresh token needed — just request a new token.

### Why `client_credentials` over `authorization_code`

The auth code flow requires browser redirect and user interaction. `client_credentials` is server-to-server with no browser, fitting CLI UX. The 30-day token means re-auth happens roughly monthly with zero user interaction. Prerequisite: the OAuth app must be installed in the Linear workspace with the right scopes (one-time admin action).

### Required OAuth scopes

- `read` — read issues, comments, labels, documents
- `write` — create/update issues, comments, labels
- `app:assignable` — enables delegation (agent appears in delegate picker)
- `app:mentionable` — enables @-mentions of the agent

### Credential storage

```
~/.linear-agent/
  token.json          # { access_token, expires_at } — 0600 permissions
  events/             # Webhook event files
    <timestamp>-<uuid>.json
```

`LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` come from environment variables (not stored in files). Token file is a cache — if deleted, server re-authenticates on next startup.

## MCP Tools

### Issue management

| Tool | Inputs | Description |
|------|--------|-------------|
| `linear_list_issues` | `teamId?`, `projectId?`, `states?`, `assigneeId?`, `delegateId?`, `labelIds?`, `first?` | List issues with filtering. Returns id, identifier, title, state, priority, labels, assignee, delegate. |
| `linear_get_issue` | `issueId` (ID or identifier like "WOT-42") | Full issue detail including description, parent, children, last 10 comments. |
| `linear_create_issue` | `teamId`, `title`, `description?`, `stateName?`, `priority?`, `assigneeId?`, `delegateId?`, `labelIds?`, `parentId?`, `projectId?` | Create issue. `stateName` auto-resolves to state ID. `delegateId` accepts `"me"` (→ app ID) or `null`. |
| `linear_update_issue` | `issueId`, plus any updatable fields | Update issue fields. Same conveniences as create. |

### Issue relations

| Tool | Inputs | Description |
|------|--------|-------------|
| `linear_set_relation` | `issueId`, `type` (`relatedTo`/`blockedBy`/`blocks`/`duplicateOf`), `targetId` | Create a relation between two issues. |
| `linear_remove_relation` | `issueId`, `type`, `targetId` | Remove a relation. |

### Comments

| Tool | Inputs | Description |
|------|--------|-------------|
| `linear_list_comments` | `issueId`, `first?`, `after?` | Paginated comment list. Returns id, body, user, createdAt. |
| `linear_create_comment` | `issueId`, `body` | Post a comment. Markdown supported. |

### Labels

| Tool | Inputs | Description |
|------|--------|-------------|
| `linear_list_labels` | `teamId?` | List labels, optionally filtered by team. Returns id, name, color, parent. |
| `linear_create_label` | `teamId`, `name`, `color?`, `parentId?` | Create a label. `parentId` for grouping under a parent. |

### Teams and users

| Tool | Inputs | Description |
|------|--------|-------------|
| `linear_list_teams` | (none) | List workspace teams. |
| `linear_list_users` | (none) | List workspace members. |
| `linear_get_viewer` | (none) | Get the authenticated app entity. Returns id, name. Used for "me" resolution. |

### Documents and attachments

| Tool | Inputs | Description |
|------|--------|-------------|
| `linear_search_documents` | `query`, `projectId?` | Search project documents. |
| `linear_get_document` | `documentId` | Get full document content. |
| `linear_get_attachment` | `issueId` | Get attachments on an issue. |

### Agent sessions

| Tool | Inputs | Description |
|------|--------|-------------|
| `linear_create_session` | `issueId`, `externalUrl?` | Create agent session on an issue. Returns sessionId. |
| `linear_update_session` | `sessionId`, `status?`, `externalUrl?`, `plan?` | Update session status, URL, or plan checklist. Plan is an array of `{title, status}` items — replaces entire plan. |
| `linear_create_activity` | `sessionId`, `type` (`thought`/`action`/`elicitation`/`response`/`error`), `body`, `ephemeral?` | Emit activity. Markdown supported. Ephemeral activities are replaced by the next one. |

### Webhook events

| Tool | Inputs | Description |
|------|--------|-------------|
| `linear_poll_events` | `types?` | Read pending events from `~/.linear-agent/events/`. Returns sorted array, deletes consumed files. Empty array if none pending. |
| `linear_get_webhook_status` | (none) | Diagnostic: last event timestamp, pending count. |

### Utility

| Tool | Inputs | Description |
|------|--------|-------------|
| `linear_list_states` | `teamId` | List workflow states for a team. Returns id, name, type, position. Cached after first call per team. |

**Total: 22 tools.** Covers all existing `mcp__claude_ai_Linear__*` usage plus agent sessions, relations, and webhook events.

## Webhook Architecture

### Setup (one-time)

1. Deploy webhook receiver (local HTTP server + `cloudflared tunnel`)
2. Register webhook in Linear: Settings → API → Webhooks
   - URL: tunnel's public endpoint
   - Events: `AgentSessionEvent`
   - Secret: shared HMAC secret for signature validation

### Webhook receiver

A lightweight HTTP server (~60 lines) that:
1. Validates Linear's HMAC-SHA256 signature header
2. Parses the event JSON
3. Writes to `~/.linear-agent/events/{unix_ms}-{uuid}.json`
4. Returns 200 OK

### Event file format

Filename: `{unix_ms}-{random_id}.json` (sortable by arrival time).

```json
{
  "type": "AgentSessionEvent",
  "action": "created",
  "createdAt": "2026-04-05T12:00:00Z",
  "data": {
    "id": "session-id",
    "issueId": "issue-id",
    "issueIdentifier": "WOT-42",
    "promptContext": "..."
  },
  "receivedAt": "2026-04-05T12:00:00Z"
}
```

### Event consumption

`linear_poll_events` reads all `.json` files from the events directory, returns them sorted chronologically, and deletes consumed files. Called at heartbeat start.

### Latency trade-off

Linear expects 5-10 second agent response to webhooks. WoterClip's heartbeat model is poll-based — sessions show as "pending" until the next heartbeat. This is acceptable for the current architecture. Real-time webhook-driven auto-start would require a persistent daemon that spawns Claude Code sessions on demand — a fundamentally different design to be addressed separately.

## Project structure

```
/Users/scottzilla/code/claude-hub/plugins/scottclip/mcp/linear-agent/
  src/
    server.ts              # MCP server entry, tool registration
    graphql.ts             # Linear GraphQL client (queries + mutations)
    auth.ts                # Token manager (client_credentials flow)
    events.ts              # Event directory reader/cleaner
    state-cache.ts         # Workflow state name → ID cache
    tools/
      issues.ts            # list, get, create, update issues + relations
      comments.ts          # list, create comments
      labels.ts            # list, create labels
      teams.ts             # list teams, users, viewer
      documents.ts         # search, get documents + attachments
      sessions.ts          # create/update sessions, create activities
      events.ts            # poll events, webhook status
      states.ts            # list workflow states
  webhook/
    receiver.ts            # Standalone HTTP server for webhook events
  package.json
  tsconfig.json
  .env.example             # Template for required env vars
```

### Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework
- `zod` — Input validation
- `typescript` / `tsx` — Build and dev

No external HTTP client library — use Node.js built-in `fetch` (available in Node 18+) for GraphQL calls. No Express/Hono for the webhook receiver — use Node.js built-in `http` module (keeps it lightweight, zero-dep).

## State name resolution

Linear's API requires state IDs, not names. This MCP resolves names transparently:

1. `linear_create_issue` and `linear_update_issue` accept `stateName` (e.g., "In Progress")
2. On first use per team, query `workflowStates` and cache the name → ID mapping
3. If both `stateId` and `stateName` are provided, `stateId` takes precedence
4. Cache invalidated on MCP server restart (acceptable for ephemeral process)

## Migration path (WoterClip)

### Phase 1: Build and test

Implement the MCP server in `claude-hub/plugins/scottclip/mcp/linear-agent/`. Test against Linear's API independently. No WoterClip changes.

### Phase 2: Dual-stack

Run both MCPs side by side. Verify new tools work from Claude Code.

### Phase 3: Migrate references

Replace all `mcp__claude_ai_Linear__*` references in WoterClip. Key mapping:

| Old | New |
|-----|-----|
| `save_issue` (create) | `linear_create_issue` |
| `save_issue` (update) | `linear_update_issue` |
| `save_comment` | `linear_create_comment` |
| `list_issues` | `linear_list_issues` |
| `get_issue` | `linear_get_issue` |
| `list_comments` | `linear_list_comments` |
| `list_issue_labels` | `linear_list_labels` |
| `create_issue_label` | `linear_create_label` |
| `get_attachment` | `linear_get_attachment` |
| `search_documentation` | `linear_search_documents` |
| `get_document` | `linear_get_document` |
| `list_teams` | `linear_list_teams` |
| `list_users` | `linear_list_users` |

~19 files in WoterClip need updating.

### Phase 4: Agent sessions

Add session creation/activities to heartbeat and persona workers. Sessions enhance Linear UI visibility but don't change WoterClip's core behavior.

### Phase 5: Delegate locking

Replace `assignee: "me"` with `delegate: "me"` in the heartbeat claim step. Implements the pending delegate locking design.

### Phase 6: Remove old MCP

Drop `mcp__claude_ai_Linear__*` dependency entirely.

## Security considerations

- OAuth token stored in `~/.linear-agent/token.json` with `0600` permissions. 30-day expiry limits blast radius. Revocable via Linear admin panel.
- Webhook receiver **must** validate Linear's HMAC-SHA256 signature. The tunnel URL may be semi-public — signature validation is the only defense against spoofed events.
- `LINEAR_CLIENT_SECRET` stays in environment variables, never written to disk.
- No admin scope requested — `actor=app` cannot request admin scope per Linear's docs.

## Out of scope

- **Real-time webhook-driven auto-start** — requires a persistent daemon that spawns Claude sessions. Different architecture, deferred.
- **Multi-machine support** — file-based event queue is single-machine. Would need SQS or similar to scale.
- **Cloudflare Worker deployment** — for now, local webhook receiver + tunnel. Can migrate to Worker + KV polling later.
- **WoterClip migration** — Phases 3-6 are WoterClip plugin changes, not part of this MCP server build.
