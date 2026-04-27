import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface RegistryEntry {
  teamId: string;
  cwd: string;
  configPath: string;
  organizationId: string;
  registeredAt: string;
  lastEventAt: string | null;
}

export interface RegistryFile {
  version: 1;
  teams: Record<string, RegistryEntry>;
}

function home(): string {
  return process.env.SCOTTCLIP_HOME || join(homedir(), ".scottclip");
}

function registryPath(): string {
  return join(home(), "registry.json");
}

function lockPath(): string {
  return join(home(), "registry.lock");
}

let cache: { data: RegistryFile; mtimeMs: number } | null = null;

function ensureHome(): void {
  const dir = home();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function readNow(): RegistryFile {
  const path = registryPath();
  if (!existsSync(path)) {
    return { version: 1, teams: {} };
  }
  const stat = statSync(path);
  if (cache && cache.mtimeMs === stat.mtimeMs) {
    return cache.data;
  }
  const raw = readFileSync(path, "utf-8");
  const data = JSON.parse(raw) as RegistryFile;
  cache = { data, mtimeMs: stat.mtimeMs };
  return data;
}

const LOCK_TTL_MS = 5000;

function acquireLock(): number {
  ensureHome();
  const lp = lockPath();
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return openSync(lp, "wx");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      // Stale lock check
      try {
        const stat = statSync(lp);
        if (Date.now() - stat.mtimeMs > LOCK_TTL_MS) {
          unlinkSync(lp);
          continue;
        }
      } catch {
        // Lock disappeared between check and stat — retry
        continue;
      }
      // Busy — sleep 100ms via blocking spinwait
      const start = Date.now();
      while (Date.now() - start < 100) {
        // intentional spin for sync API
      }
    }
  }
  throw new Error(`Could not acquire registry lock at ${lp} after 50 attempts`);
}

function releaseLock(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // ignore
  }
  try {
    unlinkSync(lockPath());
  } catch {
    // ignore
  }
}

function writeAtomic(data: RegistryFile): void {
  ensureHome();
  const path = registryPath();
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
  cache = null;
}

export function list(): RegistryEntry[] {
  return Object.values(readNow().teams);
}

export function lookup(teamId: string): RegistryEntry | null {
  return readNow().teams[teamId] ?? null;
}

export function register(entry: Omit<RegistryEntry, "registeredAt" | "lastEventAt"> & {
  registeredAt?: string;
  lastEventAt?: string | null;
}): RegistryEntry {
  const fd = acquireLock();
  try {
    const data = readNow();
    const now = new Date().toISOString();
    const existing = data.teams[entry.teamId];
    const merged: RegistryEntry = {
      teamId: entry.teamId,
      cwd: entry.cwd,
      configPath: entry.configPath,
      organizationId: entry.organizationId,
      registeredAt: existing?.registeredAt ?? entry.registeredAt ?? now,
      lastEventAt: entry.lastEventAt ?? existing?.lastEventAt ?? null,
    };
    const next: RegistryFile = {
      version: 1,
      teams: { ...data.teams, [entry.teamId]: merged },
    };
    writeAtomic(next);
    return merged;
  } finally {
    releaseLock(fd);
  }
}

export function remove(teamId: string): void {
  const fd = acquireLock();
  try {
    const data = readNow();
    if (!data.teams[teamId]) return;
    const { [teamId]: _, ...rest } = data.teams;
    writeAtomic({ version: 1, teams: rest });
  } finally {
    releaseLock(fd);
  }
}

export function touch(teamId: string): void {
  const fd = acquireLock();
  try {
    const data = readNow();
    const entry = data.teams[teamId];
    if (!entry) return;
    const next: RegistryFile = {
      version: 1,
      teams: {
        ...data.teams,
        [teamId]: { ...entry, lastEventAt: new Date().toISOString() },
      },
    };
    writeAtomic(next);
  } finally {
    releaseLock(fd);
  }
}
