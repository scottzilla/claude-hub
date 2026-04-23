import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface SessionMapping {
  ccSessionId: string;
  createdAt: number;
  turns: number;
}

// 7 days; sessions older than this get a cold restart
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// turn guard: cold restart after this many turns to avoid context overflow
const SESSION_MAX_TURNS = 15;

function ccFilePath(agentCwd: string, linearSessionId: string): string {
  return join(agentCwd, ".scottclip", "sessions", `${linearSessionId}.cc`);
}

async function readMapping(filePath: string): Promise<SessionMapping | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as SessionMapping;
  } catch {
    return null;
  }
}

async function writeMapping(filePath: string, mapping: SessionMapping): Promise<void> {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, JSON.stringify(mapping));
}

export interface ResumeInfo {
  /** Pass to query() options.resume — resumes existing session */
  resume: string;
}

export interface FreshInfo {
  /** Pass to query() options.sessionId — pins new session for future resume */
  sessionId: string;
}

/**
 * Look up or create a Claude session mapping for a Linear agent session.
 * Returns either resume info (existing session) or fresh info (new session).
 * Call `commitMapping` after the spawn is successfully kicked off.
 */
export async function resolveSessionMapping(
  agentCwd: string,
  linearSessionId: string,
): Promise<{ mode: "resume"; info: ResumeInfo } | { mode: "fresh"; info: FreshInfo }> {
  const filePath = ccFilePath(agentCwd, linearSessionId);
  const existing = await readMapping(filePath);

  if (existing) {
    const stale =
      Date.now() - existing.createdAt > SESSION_MAX_AGE_MS ||
      existing.turns >= SESSION_MAX_TURNS;

    if (!stale) {
      return { mode: "resume", info: { resume: existing.ccSessionId } };
    }

    // Stale — purge and fall through to fresh
    await unlink(filePath).catch(() => undefined);
  }

  const sessionId = randomUUID();
  return { mode: "fresh", info: { sessionId } };
}

/**
 * Persist (or update) the mapping after a successful spawn kickoff.
 * For fresh sessions: writes a new record with turns=1.
 * For resumed sessions: increments turns.
 */
export async function commitMapping(
  agentCwd: string,
  linearSessionId: string,
  ccSessionId: string,
): Promise<void> {
  const filePath = ccFilePath(agentCwd, linearSessionId);
  const existing = await readMapping(filePath);

  const mapping: SessionMapping = existing
    ? { ...existing, turns: existing.turns + 1 }
    : { ccSessionId, createdAt: Date.now(), turns: 1 };

  await writeMapping(filePath, mapping);
}

export { ccFilePath };
