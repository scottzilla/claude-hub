import { z } from "zod";
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
const CREATE_DOCUMENT_MUTATION = `
  mutation CreateDocument($input: DocumentCreateInput!) {
    documentCreate(input: $input) {
      success
      document { id title createdAt }
    }
  }
`;
const UPDATE_DOCUMENT_MUTATION = `
  mutation UpdateDocument($id: String!, $input: DocumentUpdateInput!) {
    documentUpdate(id: $id, input: $input) {
      success
      document { id title updatedAt }
    }
  }
`;
const LIST_DOCUMENTS_QUERY = `
  query ListDocuments($first: Int) {
    documents(first: $first) {
      nodes {
        id
        title
        project { id name }
        updatedAt
      }
    }
  }
`;
export function registerDocumentTools(server) {
    server.registerTool("linear_search_documents", {
        description: "Search project documents in Linear. Returns matching docs with title and content.",
        inputSchema: {
            query: z.string().describe("Search query"),
        },
    }, async (args) => {
        const data = await gql(SEARCH_DOCS_QUERY, { term: args.query });
        return { content: [{ type: "text", text: JSON.stringify(data.searchDocuments.nodes, null, 2) }] };
    });
    server.registerTool("linear_get_document", {
        description: "Get a Linear document by ID. Returns full content.",
        inputSchema: {
            documentId: z.string().describe("Document ID"),
        },
    }, async (args) => {
        const data = await gql(GET_DOCUMENT_QUERY, { id: args.documentId });
        return { content: [{ type: "text", text: JSON.stringify(data.document, null, 2) }] };
    });
    server.registerTool("linear_get_attachment", {
        description: "Get attachments on a Linear issue.",
        inputSchema: {
            issueId: z.string().describe("Issue ID or identifier"),
        },
    }, async (args) => {
        const data = await gql(GET_ATTACHMENTS_QUERY, { issueId: args.issueId });
        return { content: [{ type: "text", text: JSON.stringify(data.issue.attachments.nodes, null, 2) }] };
    });
    server.registerTool("linear_create_document", {
        description: "Create a new project document in Linear.",
        inputSchema: {
            title: z.string().describe("Document title"),
            content: z.string().optional().describe("Document content (markdown)"),
            projectId: z.string().optional().describe("Project ID to associate with"),
        },
    }, async (args) => {
        const input = { title: args.title };
        if (args.content)
            input.content = args.content;
        if (args.projectId)
            input.projectId = args.projectId;
        const data = await gql(CREATE_DOCUMENT_MUTATION, { input });
        return { content: [{ type: "text", text: JSON.stringify(data.documentCreate.document, null, 2) }] };
    });
    server.registerTool("linear_update_document", {
        description: "Update an existing project document.",
        inputSchema: {
            documentId: z.string().describe("Document ID"),
            title: z.string().optional().describe("New title"),
            content: z.string().optional().describe("New content (markdown)"),
        },
    }, async (args) => {
        const input = {};
        if (args.title)
            input.title = args.title;
        if (args.content)
            input.content = args.content;
        const data = await gql(UPDATE_DOCUMENT_MUTATION, { id: args.documentId, input });
        return { content: [{ type: "text", text: JSON.stringify(data.documentUpdate.document, null, 2) }] };
    });
    server.registerTool("linear_list_documents", {
        description: "List project documents. Returns title, project, and update time.",
        inputSchema: {
            first: z.number().optional().default(20).describe("Max results (default 20)"),
        },
    }, async (args) => {
        const data = await gql(LIST_DOCUMENTS_QUERY, { first: args.first });
        return { content: [{ type: "text", text: JSON.stringify(data.documents.nodes, null, 2) }] };
    });
}
