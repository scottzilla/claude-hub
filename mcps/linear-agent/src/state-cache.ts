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
