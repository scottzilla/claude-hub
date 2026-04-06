import { z } from "zod";
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
export function registerIssueTools(server) {
    server.registerTool("linear_list_issues", {
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
    }, async (args) => {
        const filter = {};
        if (args.teamId)
            filter.team = { id: { eq: args.teamId } };
        if (args.projectId)
            filter.project = { id: { eq: args.projectId } };
        if (args.states)
            filter.state = { name: { in: args.states } };
        if (args.assigneeId)
            filter.assignee = { id: { eq: args.assigneeId } };
        if (args.delegateId)
            filter.delegate = { id: { eq: args.delegateId } };
        if (args.labelNames)
            filter.labels = { name: { in: args.labelNames } };
        const data = await gql(LIST_ISSUES_QUERY, { filter, first: args.first });
        return { content: [{ type: "text", text: JSON.stringify(data.issues, null, 2) }] };
    });
    server.registerTool("linear_get_issue", {
        description: "Get a single Linear issue by ID or identifier (e.g. 'WOT-42'). Returns full detail including last 10 comments.",
        inputSchema: {
            issueId: z.string().describe("Issue ID or identifier (e.g. 'WOT-42')"),
        },
    }, async (args) => {
        const data = await gql(GET_ISSUE_QUERY, { id: args.issueId });
        return { content: [{ type: "text", text: JSON.stringify(data.issue, null, 2) }] };
    });
    server.registerTool("linear_save_issue", {
        description: "Create or update a Linear issue. If issueId is provided, updates the existing issue. If omitted, creates a new issue (teamId + title required). Use stateName for convenience (auto-resolves to state ID). delegateId accepts 'me' (this app) or null (clear).",
        inputSchema: {
            issueId: z.string().optional().describe("Issue ID or identifier to update. Omit to create a new issue."),
            teamId: z.string().optional().describe("Team ID (required for create, optional for update — needed for stateName resolution)"),
            title: z.string().optional().describe("Issue title (required for create)"),
            description: z.string().optional().describe("Issue description (markdown)"),
            stateName: z.string().optional().describe("State name (e.g. 'In Progress'). Auto-resolves to ID."),
            stateId: z.string().optional().describe("State ID (takes precedence over stateName)"),
            priority: z.number().optional().describe("Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low"),
            assigneeId: z.string().nullable().optional().describe("Assignee user ID, or null to clear"),
            delegateId: z.string().nullable().optional().describe("Delegate ID, 'me' for this app, or null to clear"),
            labelIds: z.array(z.string()).optional().describe("Label IDs to apply"),
            parentId: z.string().optional().describe("Parent issue ID (creates sub-issue)"),
            projectId: z.string().optional().describe("Project ID"),
        },
    }, async (args) => {
        const isUpdate = !!args.issueId;
        const input = {};
        if (args.title)
            input.title = args.title;
        if (args.description)
            input.description = args.description;
        if (args.stateId) {
            input.stateId = args.stateId;
        }
        else if (args.stateName) {
            const teamId = args.teamId;
            if (!teamId) {
                throw new Error("teamId is required when using stateName (needed to resolve state ID)");
            }
            input.stateId = await resolveStateName(teamId, args.stateName);
        }
        if (args.priority !== undefined)
            input.priority = args.priority;
        if (args.assigneeId !== undefined)
            input.assigneeId = args.assigneeId;
        if (args.delegateId !== undefined)
            input.delegateId = args.delegateId;
        if (args.labelIds)
            input.labelIds = args.labelIds;
        if (args.parentId)
            input.parentId = args.parentId;
        if (args.projectId)
            input.projectId = args.projectId;
        if (isUpdate) {
            const data = await gql(UPDATE_ISSUE_MUTATION, { id: args.issueId, input });
            return { content: [{ type: "text", text: JSON.stringify(data.issueUpdate.issue, null, 2) }] };
        }
        else {
            if (!args.teamId || !args.title) {
                throw new Error("teamId and title are required when creating a new issue");
            }
            input.teamId = args.teamId;
            if (!input.title)
                input.title = args.title;
            const data = await gql(CREATE_ISSUE_MUTATION, { input });
            return { content: [{ type: "text", text: JSON.stringify(data.issueCreate.issue, null, 2) }] };
        }
    });
}
