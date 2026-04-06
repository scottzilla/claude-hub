import { z } from "zod";
import { getTeamStates } from "../state-cache.js";
export function registerStateTools(server) {
    server.registerTool("linear_list_states", {
        description: "List workflow states for a team. Returns id, name, type, position. Results are cached.",
        inputSchema: {
            teamId: z.string().describe("Team ID"),
        },
    }, async (args) => {
        const states = await getTeamStates(args.teamId);
        return { content: [{ type: "text", text: JSON.stringify(states, null, 2) }] };
    });
}
