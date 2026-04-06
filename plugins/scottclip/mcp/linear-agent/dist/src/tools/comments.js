import { z } from "zod";
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
const DELETE_COMMENT_MUTATION = `
  mutation DeleteComment($id: String!) {
    commentDelete(id: $id) {
      success
    }
  }
`;
export function registerCommentTools(server) {
    server.registerTool("linear_list_comments", {
        description: "List comments on a Linear issue, ordered by creation time.",
        inputSchema: {
            issueId: z.string().describe("Issue ID or identifier"),
            first: z.number().optional().default(20).describe("Max results (default 20)"),
        },
    }, async (args) => {
        const data = await gql(LIST_COMMENTS_QUERY, { issueId: args.issueId, first: args.first });
        return { content: [{ type: "text", text: JSON.stringify(data.issue.comments, null, 2) }] };
    });
    server.registerTool("linear_create_comment", {
        description: "Post a comment on a Linear issue. Supports markdown.",
        inputSchema: {
            issueId: z.string().describe("Issue ID or identifier"),
            body: z.string().describe("Comment body (markdown supported)"),
        },
    }, async (args) => {
        const data = await gql(CREATE_COMMENT_MUTATION, { input: { issueId: args.issueId, body: args.body } });
        return { content: [{ type: "text", text: JSON.stringify(data.commentCreate.comment, null, 2) }] };
    });
    server.registerTool("linear_delete_comment", {
        description: "Delete a comment by ID.",
        inputSchema: {
            commentId: z.string().describe("Comment ID to delete"),
        },
    }, async (args) => {
        const data = await gql(DELETE_COMMENT_MUTATION, { id: args.commentId });
        return { content: [{ type: "text", text: JSON.stringify(data.commentDelete, null, 2) }] };
    });
}
