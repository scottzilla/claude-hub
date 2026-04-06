import { getAccessToken } from "./auth.js";
const LINEAR_API = "https://api.linear.app/graphql";
export async function gql(query, variables) {
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
    const json = (await res.json());
    if (json.errors?.length) {
        const messages = json.errors.map((e) => e.message).join("; ");
        throw new Error(`GraphQL error: ${messages}`);
    }
    if (!json.data) {
        throw new Error("Linear API returned no data");
    }
    return json.data;
}
