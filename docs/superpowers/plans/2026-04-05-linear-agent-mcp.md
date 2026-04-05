# Linear Agent MCP Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a custom MCP server that connects Claude Code to Linear's GraphQL API with `actor=app` OAuth, exposing 22 tools for issue management, agent sessions, and webhook event consumption.

**Architecture:** TypeScript MCP server using stdio transport. Authenticates via `client_credentials` OAuth grant (30-day tokens). Tool handlers call Linear's GraphQL API via native `fetch`. Webhook events arrive via a separate HTTP receiver process and are consumed through a file-based queue.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `zod`, Node.js 18+ (native fetch)

**Spec:** `docs/superpowers/specs/2026-04-05-linear-agent-mcp-design.md`

---

## File Structure

```
mcps/linear-agent/
  src/
    server.ts              # MCP entry point, tool registration, stdio transport
    graphql.ts             # Linear GraphQL client (fetch-based, handles auth header)
    auth.ts                # OAuth token manager (client_credentials, file cache)
    state-cache.ts         # Workflow state name → ID resolver with per-team cache
    events.ts              # File-based event queue reader (poll + delete)
    tools/
      issues.ts            # linear_list_issues, linear_get_issue, linear_create_issue, linear_update_issue
      relations.ts         # linear_set_relation, linear_remove_relation
      comments.ts          # linear_list_comments, linear_create_comment
      labels.ts            # linear_list_labels, linear_create_label
      teams.ts             # linear_list_teams, linear_list_users, linear_get_viewer
      documents.ts         # linear_search_documents, linear_get_document, linear_get_attachment
      sessions.ts          # linear_create_session, linear_update_session, linear_create_activity
      events.ts            # linear_poll_events, linear_get_webhook_status
      states.ts            # linear_list_states
  webhook/
    receiver.ts            # Standalone HTTP server for Linear webhook events
  package.json
  tsconfig.json
  .env.example
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `mcps/linear-agent/package.json`
- Create: `mcps/linear-agent/tsconfig.json`
- Create: `mcps/linear-agent/.env.example`
- Create: `mcps/linear-agent/src/server.ts` (minimal — just starts, no tools)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "linear-agent",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "linear-agent": "./dist/server.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/server.ts",
    "prepare": "npm run build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `.env.example`**

```bash
# Linear OAuth app credentials (actor=app)
LINEAR_CLIENT_ID=your_client_id
LINEAR_CLIENT_SECRET=your_client_secret

# Webhook secret for HMAC signature validation
LINEAR_WEBHOOK_SECRET=your_webhook_secret

# Optional: override token/event storage directory (default: ~/.linear-agent/)
# LINEAR_AGENT_DIR=~/.linear-agent
```

- [ ] **Step 4: Create minimal `src/server.ts`**

```typescript
#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "linear-agent",
  version: "0.1.0",
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("linear-agent MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

export { server };
```

- [ ] **Step 5: Install dependencies and verify build**

```bash
cd mcps/linear-agent && npm install && npm run build
```

Expected: `dist/server.js` created, no errors.

- [ ] **Step 6: Commit**

```bash
git add mcps/linear-agent/
git commit -m "feat(linear-agent): scaffold MCP server project"
```

---

### Task 2: Auth module

**Files:**
- Create: `mcps/linear-agent/src/auth.ts`

- [ ] **Step 1: Implement token manager**

```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

interface TokenData {
  access_token: string;
  expires_at: string; // ISO 8601
}

const AGENT_DIR = process.env.LINEAR_AGENT_DIR || join(homedir(), ".linear-agent");
const TOKEN_PATH = join(AGENT_DIR, "token.json");
const TOKEN_ENDPOINT = "https://api.linear.app/oauth/token";
const REFRESH_BUFFER_MS = 60 * 60 * 1000; // 1 hour

let cachedToken: TokenData | null = null;

async function ensureDir(): Promise<void> {
  await mkdir(AGENT_DIR, { recursive: true, mode: 0o700 });
}

async function loadCachedToken(): Promise<TokenData | null> {
  try {
    const raw = await readFile(TOKEN_PATH, "utf-8");
    return JSON.parse(raw) as TokenData;
  } catch {
    return null;
  }
}

async function persistToken(token: TokenData): Promise<void> {
  await ensureDir();
  await writeFile(TOKEN_PATH, JSON.stringify(token, null, 2), { mode: 0o600 });
}

async function requestToken(): Promise<TokenData> {
  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET must be set. " +
      "Create an OAuth app at https://linear.app/settings/api/applications"
    );
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      actor: "app",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token request failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  const token: TokenData = {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };

  await persistToken(token);
  return token;
}

function isExpiringSoon(token: TokenData): boolean {
  return new Date(token.expires_at).getTime() - Date.now() < REFRESH_BUFFER_MS;
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && !isExpiringSoon(cachedToken)) {
    return cachedToken.access_token;
  }

  const stored = await loadCachedToken();
  if (stored && !isExpiringSoon(stored)) {
    cachedToken = stored;
    return stored.access_token;
  }

  cachedToken = await requestToken();
  return cachedToken.access_token;
}

export { AGENT_DIR };
```

- [ ] **Step 2: Commit**

```bash
git add mcps/linear-agent/src/auth.ts
git commit -m "feat(linear-agent): add OAuth token manager (client_credentials)"
```

---

### Task 3: GraphQL client

**Files:**
- Create: `mcps/linear-agent/src/graphql.ts`

- [ ] **Step 1: Implement GraphQL client**

```typescript
import { getAccessToken } from "./auth.js";

const LINEAR_API = "https://api.linear.app/graphql";

export interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

export async function gql<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = await getAccessToken();

  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) {
      throw new Error("Linear API authentication failed. Check your OAuth credentials.");
    }
    if (res.status === 429) {
      throw new Error("Linear API rate limited. Please wait and retry.");
    }
    throw new Error(`Linear API error (${res.status}): ${body}`);
  }

  const json = (await res.json()) as GraphQLResponse<T>;

  if (json.errors?.length) {
    const messages = json.errors.map((e) => e.message).join("; ");
    throw new Error(`GraphQL error: ${messages}`);
  }

  if (!json.data) {
    throw new Error("Linear API returned no data");
  }

  return json.data;
}
```

- [ ] **Step 2: Commit**

```bash
git add mcps/linear-agent/src/graphql.ts
git commit -m "feat(linear-agent): add GraphQL client with auth integration"
```

---

### Task 4: State cache

**Files:**
- Create: `mcps/linear-agent/src/state-cache.ts`

- [ ] **Step 1: Implement state name resolver**

```typescript
import { gql } from "./graphql.js";

interface WorkflowState {
  id: string;
  name: string;
  type: string;
  position: number;
}

const cache = new Map<string, WorkflowState[]>();

const STATES_QUERY = `
  query TeamStates($teamId: String!) {
    team(id: $teamId) {
      states {
        nodes {
          id
          name
          type
          position
        }
      }
    }
  }
`;

export async function getTeamStates(teamId: string): Promise<WorkflowState[]> {
  const cached = cache.get(teamId);
  if (cached) return cached;

  const data = await gql<{
    team: { states: { nodes: WorkflowState[] } };
  }>(STATES_QUERY, { teamId });

  const states = data.team.states.nodes.sort((a, b) => a.position - b.position);
  cache.set(teamId, states);
  return states;
}

export async function resolveStateName(
  teamId: string,
  stateName: string,
): Promise<string> {
  const states = await getTeamStates(teamId);
  const match = states.find(
    (s) => s.name.toLowerCase() === stateName.toLowerCase(),
  );
  if (!match) {
    const available = states.map((s) => s.name).join(", ");
    throw new Error(`State "${stateName}" not found for team. Available: ${available}`);
  }
  return match.id;
}

export function listCachedStates(): WorkflowState[] {
  return Array.from(cache.values()).flat();
}
```

- [ ] **Step 2: Commit**

```bash
git add mcps/linear-agent/src/state-cache.ts
git commit -m "feat(linear-agent): add workflow state name → ID cache"
```

---

### Task 5: Event queue reader

**Files:**
- Create: `mcps/linear-agent/src/events.ts`

- [ ] **Step 1: Implement event file reader**

```typescript
import { readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_DIR } from "./auth.js";

const EVENTS_DIR = join(AGENT_DIR, "events");

export interface WebhookEvent {
  type: string;
  action: string;
  createdAt: string;
  data: Record<string, unknown>;
  receivedAt: string;
}

export async function pollEvents(types?: string[]): Promise<WebhookEvent[]> {
  let files: string[];
  try {
    files = await readdir(EVENTS_DIR);
  } catch {
    return []; // directory doesn't exist yet — no events
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();
  const events: WebhookEvent[] = [];

  for (const file of jsonFiles) {
    const path = join(EVENTS_DIR, file);
    try {
      const raw = await readFile(path, "utf-8");
      const event = JSON.parse(raw) as WebhookEvent;

      if (types && types.length > 0 && !types.includes(event.type)) {
        continue; // skip non-matching types, don't delete
      }

      events.push(event);
      await unlink(path); // consume the event
    } catch {
      // skip malformed files, leave them for debugging
    }
  }

  return events;
}

export async function getEventStats(): Promise<{
  pendingCount: number;
  lastEventTime: string | null;
}> {
  let files: string[];
  try {
    files = await readdir(EVENTS_DIR);
  } catch {
    return { pendingCount: 0, lastEventTime: null };
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();
  const pendingCount = jsonFiles.length;

  let lastEventTime: string | null = null;
  if (jsonFiles.length > 0) {
    // filename format: {unix_ms}-{uuid}.json — extract timestamp
    const lastFile = jsonFiles[jsonFiles.length - 1];
    const ms = parseInt(lastFile.split("-")[0], 10);
    if (!isNaN(ms)) {
      lastEventTime = new Date(ms).toISOString();
    }
  }

  return { pendingCount, lastEventTime };
}
```

- [ ] **Step 2: Commit**

```bash
git add mcps/linear-agent/src/events.ts
git commit -m "feat(linear-agent): add file-based webhook event queue reader"
```

---

### Task 6: Issue tools

**Files:**
- Create: `mcps/linear-agent/src/tools/issues.ts`

- [ ] **Step 1: Implement issue tools**

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gql } from "../graphql.js";
import { resolveStateName } from "../state-cache.js";

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  url
  priority
  priorityLabel
  state { id name type }
  assignee { id name }
  delegate { id name }
  labels { nodes { id name color } }
  parent { id identifier title }
  children { nodes { id identifier title state { name } } }
`;

const LIST_ISSUES_QUERY = `
  query ListIssues($filter: IssueFilter, $first: Int, $after: String) {
    issues(filter: $filter, first: $first, after: $after) {
      nodes {
        ${ISSUE_FIELDS}
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const GET_ISSUE_QUERY = `
  query GetIssue($id: String!) {
    issue(id: $id) {
      ${ISSUE_FIELDS}
      comments(first: 10, orderBy: createdAt) {
        nodes {
          id
          body
          user { id name }
          createdAt
        }
      }
    }
  }
`;

const CREATE_ISSUE_MUTATION = `
  mutation CreateIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue { ${ISSUE_FIELDS} }
    }
  }
`;

const UPDATE_ISSUE_MUTATION = `
  mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue { ${ISSUE_FIELDS} }
    }
  }
`;

export function registerIssueTools(server: McpServer) {
  server.registerTool(
    "linear_list_issues",
    {
      description: "List Linear issues with filtering. Returns id, identifier, title, state, priority, labels, assignee, delegate.",
      inputSchema: {
        teamId: z.string().optional().describe("Filter by team ID"),
        projectId: z.string().optional().describe("Filter by project ID"),
        states: z.array(z.string()).optional().describe("Filter by state names (e.g. ['Todo', 'In Progress'])"),
        assigneeId: z.string().optional().describe("Filter by assignee ID. Use 'me' for the authenticated app."),
        delegateId: z.string().optional().describe("Filter by delegate ID. Use 'me' for the authenticated app."),
        labelNames: z.array(z.string()).optional().describe("Filter by label names"),
        first: z.number().optional().default(50).describe("Max results (default 50)"),
      },
    },
    async (args) => {
      const filter: Record<string, unknown> = {};
      if (args.teamId) filter.team = { id: { eq: args.teamId } };
      if (args.projectId) filter.project = { id: { eq: args.projectId } };
      if (args.states) filter.state = { name: { in: args.states } };
      if (args.assigneeId) filter.assignee = { id: { eq: args.assigneeId } };
      if (args.delegateId) filter.delegate = { id: { eq: args.delegateId } };
      if (args.labelNames) filter.labels = { name: { in: args.labelNames } };

      const data = await gql<{
        issues: { nodes: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: string } };
      }>(LIST_ISSUES_QUERY, { filter, first: args.first });

      return { content: [{ type: "text" as const, text: JSON.stringify(data.issues, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_get_issue",
    {
      description: "Get a single Linear issue by ID or identifier (e.g. 'WOT-42'). Returns full detail including last 10 comments.",
      inputSchema: {
        issueId: z.string().describe("Issue ID or identifier (e.g. 'WOT-42')"),
      },
    },
    async (args) => {
      const data = await gql<{ issue: unknown }>(GET_ISSUE_QUERY, { id: args.issueId });
      return { content: [{ type: "text" as const, text: JSON.stringify(data.issue, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_create_issue",
    {
      description: "Create a new Linear issue. Use stateName for convenience (auto-resolves to state ID).",
      inputSchema: {
        teamId: z.string().describe("Team ID (required)"),
        title: z.string().describe("Issue title"),
        description: z.string().optional().describe("Issue description (markdown)"),
        stateName: z.string().optional().describe("State name (e.g. 'Todo'). Auto-resolves to ID."),
        priority: z.number().optional().describe("Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low"),
        assigneeId: z.string().optional().describe("Assignee user ID"),
        delegateId: z.string().optional().describe("Delegate (agent) ID. Use 'me' for this app."),
        labelIds: z.array(z.string()).optional().describe("Label IDs to apply"),
        parentId: z.string().optional().describe("Parent issue ID (creates sub-issue)"),
        projectId: z.string().optional().describe("Project ID"),
      },
    },
    async (args) => {
      const input: Record<string, unknown> = {
        teamId: args.teamId,
        title: args.title,
      };
      if (args.description) input.description = args.description;
      if (args.stateName) input.stateId = await resolveStateName(args.teamId, args.stateName);
      if (args.priority !== undefined) input.priority = args.priority;
      if (args.assigneeId) input.assigneeId = args.assigneeId;
      if (args.delegateId) input.delegateId = args.delegateId;
      if (args.labelIds) input.labelIds = args.labelIds;
      if (args.parentId) input.parentId = args.parentId;
      if (args.projectId) input.projectId = args.projectId;

      const data = await gql<{ issueCreate: { success: boolean; issue: unknown } }>(
        CREATE_ISSUE_MUTATION,
        { input },
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data.issueCreate.issue, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_update_issue",
    {
      description: "Update a Linear issue. Use stateName for convenience. delegateId accepts 'me' (this app) or null (clear delegate).",
      inputSchema: {
        issueId: z.string().describe("Issue ID or identifier"),
        title: z.string().optional().describe("New title"),
        description: z.string().optional().describe("New description (markdown)"),
        stateName: z.string().optional().describe("State name (e.g. 'In Progress'). Auto-resolves to ID."),
        stateId: z.string().optional().describe("State ID (takes precedence over stateName)"),
        priority: z.number().optional().describe("Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low"),
        assigneeId: z.string().nullable().optional().describe("Assignee user ID, or null to clear"),
        delegateId: z.string().nullable().optional().describe("Delegate ID, 'me' for this app, or null to clear"),
        labelIds: z.array(z.string()).optional().describe("Label IDs (replaces all labels)"),
        parentId: z.string().optional().describe("Parent issue ID"),
        teamId: z.string().optional().describe("Team ID (needed for stateName resolution if not already cached)"),
      },
    },
    async (args) => {
      const input: Record<string, unknown> = {};
      if (args.title) input.title = args.title;
      if (args.description) input.description = args.description;
      if (args.stateId) {
        input.stateId = args.stateId;
      } else if (args.stateName && args.teamId) {
        input.stateId = await resolveStateName(args.teamId, args.stateName);
      } else if (args.stateName) {
        throw new Error("teamId is required when using stateName (needed to resolve state ID)");
      }
      if (args.priority !== undefined) input.priority = args.priority;
      if (args.assigneeId !== undefined) input.assigneeId = args.assigneeId;
      if (args.delegateId !== undefined) input.delegateId = args.delegateId;
      if (args.labelIds) input.labelIds = args.labelIds;
      if (args.parentId) input.parentId = args.parentId;

      const data = await gql<{ issueUpdate: { success: boolean; issue: unknown } }>(
        UPDATE_ISSUE_MUTATION,
        { id: args.issueId, input },
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data.issueUpdate.issue, null, 2) }] };
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add mcps/linear-agent/src/tools/issues.ts
git commit -m "feat(linear-agent): add issue tools (list, get, create, update)"
```

---

### Task 7: Relations tools

**Files:**
- Create: `mcps/linear-agent/src/tools/relations.ts`

- [ ] **Step 1: Implement relation tools**

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gql } from "../graphql.js";

const ADD_RELATION_MUTATION = `
  mutation AddRelation($input: IssueRelationCreateInput!) {
    issueRelationCreate(input: $input) {
      success
      issueRelation { id type issue { identifier } relatedIssue { identifier } }
    }
  }
`;

const DELETE_RELATION_MUTATION = `
  mutation DeleteRelation($id: String!) {
    issueRelationDelete(id: $id) {
      success
    }
  }
`;

const LIST_RELATIONS_QUERY = `
  query IssueRelations($id: String!) {
    issue(id: $id) {
      relations {
        nodes {
          id
          type
          relatedIssue { id identifier title }
        }
      }
      inverseRelations {
        nodes {
          id
          type
          issue { id identifier title }
        }
      }
    }
  }
`;

export function registerRelationTools(server: McpServer) {
  server.registerTool(
    "linear_set_relation",
    {
      description: "Create a relation between two issues. Types: relatedTo, blocks, blockedBy, duplicate.",
      inputSchema: {
        issueId: z.string().describe("Source issue ID or identifier"),
        type: z.enum(["relatedTo", "blocks", "blockedBy", "duplicate"]).describe("Relation type"),
        relatedIssueId: z.string().describe("Target issue ID or identifier"),
      },
    },
    async (args) => {
      const typeMap: Record<string, string> = {
        relatedTo: "related",
        blocks: "blocks",
        blockedBy: "blocked",
        duplicate: "duplicate",
      };
      const data = await gql<{ issueRelationCreate: { success: boolean; issueRelation: unknown } }>(
        ADD_RELATION_MUTATION,
        { input: { issueId: args.issueId, relatedIssueId: args.relatedIssueId, type: typeMap[args.type] } },
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data.issueRelationCreate, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_remove_relation",
    {
      description: "Remove a relation between two issues. First lists relations to find the relation ID, then deletes it.",
      inputSchema: {
        issueId: z.string().describe("Source issue ID or identifier"),
        type: z.enum(["relatedTo", "blocks", "blockedBy", "duplicate"]).describe("Relation type to remove"),
        relatedIssueId: z.string().describe("Target issue ID or identifier"),
      },
    },
    async (args) => {
      // Find the relation ID first
      const issueData = await gql<{
        issue: {
          relations: { nodes: Array<{ id: string; type: string; relatedIssue: { id: string } }> };
          inverseRelations: { nodes: Array<{ id: string; type: string; issue: { id: string } }> };
        };
      }>(LIST_RELATIONS_QUERY, { id: args.issueId });

      const allRelations = [
        ...issueData.issue.relations.nodes.map((r) => ({ ...r, targetId: r.relatedIssue.id })),
        ...issueData.issue.inverseRelations.nodes.map((r) => ({ ...r, targetId: r.issue.id })),
      ];

      const match = allRelations.find((r) => r.targetId === args.relatedIssueId);
      if (!match) {
        return { content: [{ type: "text" as const, text: "No matching relation found." }] };
      }

      const data = await gql<{ issueRelationDelete: { success: boolean } }>(
        DELETE_RELATION_MUTATION,
        { id: match.id },
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data.issueRelationDelete, null, 2) }] };
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add mcps/linear-agent/src/tools/relations.ts
git commit -m "feat(linear-agent): add issue relation tools (set, remove)"
```

---

### Task 8: Comment tools

**Files:**
- Create: `mcps/linear-agent/src/tools/comments.ts`

- [ ] **Step 1: Implement comment tools**

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gql } from "../graphql.js";

const LIST_COMMENTS_QUERY = `
  query ListComments($issueId: String!, $first: Int, $after: String) {
    issue(id: $issueId) {
      comments(first: $first, after: $after, orderBy: createdAt) {
        nodes {
          id
          body
          user { id name }
          createdAt
          updatedAt
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const CREATE_COMMENT_MUTATION = `
  mutation CreateComment($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment {
        id
        body
        createdAt
      }
    }
  }
`;

export function registerCommentTools(server: McpServer) {
  server.registerTool(
    "linear_list_comments",
    {
      description: "List comments on a Linear issue, ordered by creation time.",
      inputSchema: {
        issueId: z.string().describe("Issue ID or identifier"),
        first: z.number().optional().default(20).describe("Max results (default 20)"),
      },
    },
    async (args) => {
      const data = await gql<{
        issue: { comments: { nodes: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: string } } };
      }>(LIST_COMMENTS_QUERY, { issueId: args.issueId, first: args.first });

      return { content: [{ type: "text" as const, text: JSON.stringify(data.issue.comments, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_create_comment",
    {
      description: "Post a comment on a Linear issue. Supports markdown.",
      inputSchema: {
        issueId: z.string().describe("Issue ID or identifier"),
        body: z.string().describe("Comment body (markdown supported)"),
      },
    },
    async (args) => {
      const data = await gql<{ commentCreate: { success: boolean; comment: unknown } }>(
        CREATE_COMMENT_MUTATION,
        { input: { issueId: args.issueId, body: args.body } },
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data.commentCreate.comment, null, 2) }] };
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add mcps/linear-agent/src/tools/comments.ts
git commit -m "feat(linear-agent): add comment tools (list, create)"
```

---

### Task 9: Label tools

**Files:**
- Create: `mcps/linear-agent/src/tools/labels.ts`

- [ ] **Step 1: Implement label tools**

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gql } from "../graphql.js";

const LIST_LABELS_QUERY = `
  query ListLabels($teamId: String) {
    issueLabels(filter: { team: { id: { eq: $teamId } } }, first: 100) {
      nodes {
        id
        name
        color
        parent { id name }
      }
    }
  }
`;

const LIST_ALL_LABELS_QUERY = `
  query ListAllLabels {
    issueLabels(first: 100) {
      nodes {
        id
        name
        color
        parent { id name }
      }
    }
  }
`;

const CREATE_LABEL_MUTATION = `
  mutation CreateLabel($input: IssueLabelCreateInput!) {
    issueLabelCreate(input: $input) {
      success
      issueLabel {
        id
        name
        color
        parent { id name }
      }
    }
  }
`;

export function registerLabelTools(server: McpServer) {
  server.registerTool(
    "linear_list_labels",
    {
      description: "List issue labels, optionally filtered by team.",
      inputSchema: {
        teamId: z.string().optional().describe("Filter labels by team ID"),
      },
    },
    async (args) => {
      const query = args.teamId ? LIST_LABELS_QUERY : LIST_ALL_LABELS_QUERY;
      const variables = args.teamId ? { teamId: args.teamId } : {};

      const data = await gql<{ issueLabels: { nodes: unknown[] } }>(query, variables);
      return { content: [{ type: "text" as const, text: JSON.stringify(data.issueLabels.nodes, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_create_label",
    {
      description: "Create a label. Use parentId to group under a parent label.",
      inputSchema: {
        teamId: z.string().describe("Team ID"),
        name: z.string().describe("Label name"),
        color: z.string().optional().describe("Color hex (e.g. '#ff0000')"),
        parentId: z.string().optional().describe("Parent label ID for grouping"),
      },
    },
    async (args) => {
      const input: Record<string, unknown> = { teamId: args.teamId, name: args.name };
      if (args.color) input.color = args.color;
      if (args.parentId) input.parentId = args.parentId;

      const data = await gql<{ issueLabelCreate: { success: boolean; issueLabel: unknown } }>(
        CREATE_LABEL_MUTATION,
        { input },
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data.issueLabelCreate.issueLabel, null, 2) }] };
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add mcps/linear-agent/src/tools/labels.ts
git commit -m "feat(linear-agent): add label tools (list, create)"
```

---

### Task 10: Teams, users, viewer tools

**Files:**
- Create: `mcps/linear-agent/src/tools/teams.ts`

- [ ] **Step 1: Implement team/user tools**

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gql } from "../graphql.js";

const LIST_TEAMS_QUERY = `
  query ListTeams {
    teams {
      nodes { id name key }
    }
  }
`;

const LIST_USERS_QUERY = `
  query ListUsers {
    users {
      nodes { id name email active }
    }
  }
`;

const VIEWER_QUERY = `
  query Viewer {
    viewer { id name email }
  }
`;

export function registerTeamTools(server: McpServer) {
  server.registerTool(
    "linear_list_teams",
    {
      description: "List workspace teams. Returns id, name, key.",
      inputSchema: {},
    },
    async () => {
      const data = await gql<{ teams: { nodes: unknown[] } }>(LIST_TEAMS_QUERY);
      return { content: [{ type: "text" as const, text: JSON.stringify(data.teams.nodes, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_list_users",
    {
      description: "List workspace members. Returns id, name, email, active status.",
      inputSchema: {},
    },
    async () => {
      const data = await gql<{ users: { nodes: unknown[] } }>(LIST_USERS_QUERY);
      return { content: [{ type: "text" as const, text: JSON.stringify(data.users.nodes, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_get_viewer",
    {
      description: "Get the authenticated entity (the OAuth app). Returns id, name. Used for 'me' resolution.",
      inputSchema: {},
    },
    async () => {
      const data = await gql<{ viewer: unknown }>(VIEWER_QUERY);
      return { content: [{ type: "text" as const, text: JSON.stringify(data.viewer, null, 2) }] };
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add mcps/linear-agent/src/tools/teams.ts
git commit -m "feat(linear-agent): add team, user, and viewer tools"
```

---

### Task 11: Document and attachment tools

**Files:**
- Create: `mcps/linear-agent/src/tools/documents.ts`

- [ ] **Step 1: Implement document tools**

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gql } from "../graphql.js";

const SEARCH_DOCS_QUERY = `
  query SearchDocs($term: String!) {
    searchDocuments(term: $term, first: 10, includeComments: false) {
      nodes {
        ... on DocumentSearchResult {
          document {
            id
            title
            content
            project { id name }
            updatedAt
          }
        }
      }
    }
  }
`;

const GET_DOCUMENT_QUERY = `
  query GetDocument($id: String!) {
    document(id: $id) {
      id
      title
      content
      project { id name }
      createdAt
      updatedAt
    }
  }
`;

const GET_ATTACHMENTS_QUERY = `
  query GetAttachments($issueId: String!) {
    issue(id: $issueId) {
      attachments {
        nodes {
          id
          title
          subtitle
          url
          metadata
          createdAt
        }
      }
    }
  }
`;

export function registerDocumentTools(server: McpServer) {
  server.registerTool(
    "linear_search_documents",
    {
      description: "Search project documents in Linear. Returns matching docs with title and content.",
      inputSchema: {
        query: z.string().describe("Search query"),
      },
    },
    async (args) => {
      const data = await gql<{ searchDocuments: { nodes: unknown[] } }>(SEARCH_DOCS_QUERY, { term: args.query });
      return { content: [{ type: "text" as const, text: JSON.stringify(data.searchDocuments.nodes, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_get_document",
    {
      description: "Get a Linear document by ID. Returns full content.",
      inputSchema: {
        documentId: z.string().describe("Document ID"),
      },
    },
    async (args) => {
      const data = await gql<{ document: unknown }>(GET_DOCUMENT_QUERY, { id: args.documentId });
      return { content: [{ type: "text" as const, text: JSON.stringify(data.document, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_get_attachment",
    {
      description: "Get attachments on a Linear issue.",
      inputSchema: {
        issueId: z.string().describe("Issue ID or identifier"),
      },
    },
    async (args) => {
      const data = await gql<{ issue: { attachments: { nodes: unknown[] } } }>(
        GET_ATTACHMENTS_QUERY,
        { issueId: args.issueId },
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data.issue.attachments.nodes, null, 2) }] };
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add mcps/linear-agent/src/tools/documents.ts
git commit -m "feat(linear-agent): add document and attachment tools"
```

---

### Task 12: Agent session tools

**Files:**
- Create: `mcps/linear-agent/src/tools/sessions.ts`

- [ ] **Step 1: Implement session tools**

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gql } from "../graphql.js";

const CREATE_SESSION_MUTATION = `
  mutation CreateSession($issueId: String!) {
    agentSessionCreateOnIssue(issueId: $issueId) {
      success
      agentSession {
        id
        status
        issue { identifier title }
        createdAt
      }
    }
  }
`;

const UPDATE_SESSION_MUTATION = `
  mutation UpdateSession($id: String!, $input: AgentSessionUpdateInput!) {
    agentSessionUpdate(id: $id, input: $input) {
      success
      agentSession {
        id
        status
        plan { content status }
      }
    }
  }
`;

const CREATE_ACTIVITY_MUTATION = `
  mutation CreateActivity($input: AgentActivityCreateInput!) {
    agentActivityCreate(input: $input) {
      success
      agentActivity {
        id
        type
        createdAt
      }
    }
  }
`;

export function registerSessionTools(server: McpServer) {
  server.registerTool(
    "linear_create_session",
    {
      description: "Create an agent session on a Linear issue. Returns sessionId. Sessions track agent work lifecycle in Linear's UI.",
      inputSchema: {
        issueId: z.string().describe("Issue ID or identifier to create session on"),
      },
    },
    async (args) => {
      const data = await gql<{
        agentSessionCreateOnIssue: { success: boolean; agentSession: unknown };
      }>(CREATE_SESSION_MUTATION, { issueId: args.issueId });

      return { content: [{ type: "text" as const, text: JSON.stringify(data.agentSessionCreateOnIssue.agentSession, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_update_session",
    {
      description: "Update an agent session: status, external URLs, or plan checklist. Plan replaces the entire checklist.",
      inputSchema: {
        sessionId: z.string().describe("Session ID"),
        status: z.enum(["active", "complete", "error", "stale"]).optional().describe("New session status"),
        externalUrls: z.array(z.object({
          label: z.string(),
          url: z.string(),
        })).optional().describe("External URLs (e.g. PR links) to display on the session"),
        plan: z.array(z.object({
          content: z.string().describe("Step description"),
          status: z.enum(["pending", "inProgress", "completed", "canceled"]).describe("Step status"),
        })).optional().describe("Plan checklist (replaces entire plan)"),
      },
    },
    async (args) => {
      const input: Record<string, unknown> = {};
      if (args.status) input.status = args.status;
      if (args.externalUrls) input.externalUrls = args.externalUrls;
      if (args.plan) input.plan = args.plan;

      const data = await gql<{
        agentSessionUpdate: { success: boolean; agentSession: unknown };
      }>(UPDATE_SESSION_MUTATION, { id: args.sessionId, input });

      return { content: [{ type: "text" as const, text: JSON.stringify(data.agentSessionUpdate.agentSession, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_create_activity",
    {
      description: "Emit an activity within an agent session. Types: thought (internal reasoning), action (tool use), elicitation (ask user), response (final result), error. Markdown supported.",
      inputSchema: {
        sessionId: z.string().describe("Session ID"),
        type: z.enum(["thought", "action", "elicitation", "response", "error"]).describe("Activity type"),
        body: z.string().describe("Activity content (markdown supported)"),
        ephemeral: z.boolean().optional().default(false).describe("If true, activity is replaced by the next one of the same type"),
      },
    },
    async (args) => {
      const input: Record<string, unknown> = {
        sessionId: args.sessionId,
        type: args.type,
        body: args.body,
      };
      if (args.ephemeral) input.ephemeral = true;

      const data = await gql<{
        agentActivityCreate: { success: boolean; agentActivity: unknown };
      }>(CREATE_ACTIVITY_MUTATION, { input });

      return { content: [{ type: "text" as const, text: JSON.stringify(data.agentActivityCreate.agentActivity, null, 2) }] };
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add mcps/linear-agent/src/tools/sessions.ts
git commit -m "feat(linear-agent): add agent session tools (create, update, activity)"
```

---

### Task 13: Event and state tools

**Files:**
- Create: `mcps/linear-agent/src/tools/events.ts`
- Create: `mcps/linear-agent/src/tools/states.ts`

- [ ] **Step 1: Implement event tools**

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pollEvents, getEventStats } from "../events.js";

export function registerEventTools(server: McpServer) {
  server.registerTool(
    "linear_poll_events",
    {
      description: "Read pending webhook events from the event queue. Returns events sorted chronologically and deletes consumed files. Empty array if none.",
      inputSchema: {
        types: z.array(z.string()).optional().describe("Filter by event type (e.g. ['AgentSessionEvent'])"),
      },
    },
    async (args) => {
      const events = await pollEvents(args.types);
      return { content: [{ type: "text" as const, text: JSON.stringify(events, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_get_webhook_status",
    {
      description: "Check webhook event queue health: pending count and last event timestamp.",
      inputSchema: {},
    },
    async () => {
      const stats = await getEventStats();
      return { content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }] };
    },
  );
}
```

- [ ] **Step 2: Implement state tools**

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTeamStates } from "../state-cache.js";

export function registerStateTools(server: McpServer) {
  server.registerTool(
    "linear_list_states",
    {
      description: "List workflow states for a team. Returns id, name, type, position. Results are cached.",
      inputSchema: {
        teamId: z.string().describe("Team ID"),
      },
    },
    async (args) => {
      const states = await getTeamStates(args.teamId);
      return { content: [{ type: "text" as const, text: JSON.stringify(states, null, 2) }] };
    },
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add mcps/linear-agent/src/tools/events.ts mcps/linear-agent/src/tools/states.ts
git commit -m "feat(linear-agent): add event polling and workflow state tools"
```

---

### Task 14: Wire up server.ts with all tools

**Files:**
- Modify: `mcps/linear-agent/src/server.ts`

- [ ] **Step 1: Update server.ts to register all tools**

Replace the entire file:

```typescript
#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerRelationTools } from "./tools/relations.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerLabelTools } from "./tools/labels.js";
import { registerTeamTools } from "./tools/teams.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerEventTools } from "./tools/events.js";
import { registerStateTools } from "./tools/states.js";

const server = new McpServer({
  name: "linear-agent",
  version: "0.1.0",
});

registerIssueTools(server);
registerRelationTools(server);
registerCommentTools(server);
registerLabelTools(server);
registerTeamTools(server);
registerDocumentTools(server);
registerSessionTools(server);
registerEventTools(server);
registerStateTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("linear-agent MCP server running on stdio (22 tools registered)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

- [ ] **Step 2: Build and verify**

```bash
cd mcps/linear-agent && npm run build
```

Expected: Clean compile, `dist/` contains all tool files.

- [ ] **Step 3: Commit**

```bash
git add mcps/linear-agent/src/server.ts
git commit -m "feat(linear-agent): wire up all 22 tools in server entry point"
```

---

### Task 15: Webhook receiver

**Files:**
- Create: `mcps/linear-agent/webhook/receiver.ts`

- [ ] **Step 1: Implement webhook receiver**

```typescript
#!/usr/bin/env node

import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const PORT = parseInt(process.env.WEBHOOK_PORT || "3847", 10);
const SECRET = process.env.LINEAR_WEBHOOK_SECRET;
const EVENTS_DIR = join(process.env.LINEAR_AGENT_DIR || join(homedir(), ".linear-agent"), "events");

if (!SECRET) {
  console.error("LINEAR_WEBHOOK_SECRET is required");
  process.exit(1);
}

function verifySignature(body: string, signature: string | null): boolean {
  if (!signature || !SECRET) return false;
  const expected = createHmac("sha256", SECRET).update(body).digest("hex");
  return signature === expected;
}

async function ensureEventsDir() {
  await mkdir(EVENTS_DIR, { recursive: true, mode: 0o700 });
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks).toString("utf-8");

  const signature = req.headers["linear-signature"] as string | undefined;
  if (!verifySignature(body, signature ?? null)) {
    console.error("Invalid webhook signature");
    res.writeHead(401);
    res.end("Invalid signature");
    return;
  }

  try {
    const event = JSON.parse(body);
    const enriched = {
      ...event,
      receivedAt: new Date().toISOString(),
    };

    await ensureEventsDir();
    const filename = `${Date.now()}-${randomUUID()}.json`;
    await writeFile(join(EVENTS_DIR, filename), JSON.stringify(enriched, null, 2), { mode: 0o600 });

    console.log(`Event received: ${event.type || "unknown"} → ${filename}`);
    res.writeHead(200);
    res.end("OK");
  } catch (err) {
    console.error("Failed to process webhook:", err);
    res.writeHead(500);
    res.end("Internal error");
  }
});

server.listen(PORT, () => {
  console.log(`Linear webhook receiver listening on port ${PORT}`);
  console.log(`Events directory: ${EVENTS_DIR}`);
  console.log("Expose this with: cloudflared tunnel --url http://localhost:" + PORT);
});
```

- [ ] **Step 2: Add webhook scripts to package.json**

Add to `scripts` in package.json:

```json
"webhook": "tsx webhook/receiver.ts",
"webhook:tunnel": "cloudflared tunnel --url http://localhost:3847"
```

Also add `"webhook"` to the `include` array in `tsconfig.json`:

```json
"include": ["src", "webhook"]
```

- [ ] **Step 3: Commit**

```bash
git add mcps/linear-agent/webhook/ mcps/linear-agent/package.json mcps/linear-agent/tsconfig.json
git commit -m "feat(linear-agent): add webhook receiver with HMAC validation"
```

---

### Task 16: Final build, verify, and push

**Files:**
- No new files

- [ ] **Step 1: Clean build**

```bash
cd mcps/linear-agent && rm -rf dist && npm run build
```

Expected: Clean compile with no errors.

- [ ] **Step 2: Verify tool count**

```bash
grep -c "registerTool" mcps/linear-agent/src/tools/*.ts
```

Expected: 22 total tool registrations across all files.

- [ ] **Step 3: Verify all imports resolve**

```bash
cd mcps/linear-agent && node -e "import('./dist/server.js').then(() => console.log('OK')).catch(e => { console.error(e); process.exit(1) })"
```

Expected: "OK" (server imports resolve — it will fail to connect transport but that's fine for import check).

- [ ] **Step 4: Push to remote**

```bash
cd /Users/scottzilla/code/claude-hub && git push
```
