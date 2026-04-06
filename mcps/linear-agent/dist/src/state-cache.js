import { gql } from "./graphql.js";
const cache = new Map();
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
export async function getTeamStates(teamId) {
    const cached = cache.get(teamId);
    if (cached)
        return cached;
    const data = await gql(STATES_QUERY, { teamId });
    const states = data.team.states.nodes.sort((a, b) => a.position - b.position);
    cache.set(teamId, states);
    return states;
}
export async function resolveStateName(teamId, stateName) {
    const states = await getTeamStates(teamId);
    const match = states.find((s) => s.name.toLowerCase() === stateName.toLowerCase());
    if (!match) {
        const available = states.map((s) => s.name).join(", ");
        throw new Error(`State "${stateName}" not found for team. Available: ${available}`);
    }
    return match.id;
}
export function listCachedStates() {
    return Array.from(cache.values()).flat();
}
