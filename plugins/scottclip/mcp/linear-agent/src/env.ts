import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

export function loadDotEnv(): void {
  const homeRoot = process.env.SCOTTCLIP_HOME || join(homedir(), ".scottclip");
  const globalPath = join(homeRoot, ".env");
  const repoPath = join(process.cwd(), ".scottclip", ".env");

  const sources: Array<{ label: string; path: string }> = [
    { label: "global", path: globalPath },
    { label: "repo", path: repoPath },
  ];

  let totalLoaded = 0;
  for (const src of sources) {
    try {
      const content = readFileSync(src.path, "utf-8");
      const vars = parseDotEnv(content);
      let loaded = 0;
      for (const [key, value] of Object.entries(vars)) {
        if (process.env[key] === undefined) {
          process.env[key] = value;
          loaded++;
        }
      }
      if (loaded > 0) {
        console.log(`Loaded ${loaded} env var(s) from ${src.path} (${src.label})`);
        totalLoaded += loaded;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(`Error reading ${src.path}:`, err);
      }
    }
  }

  if (totalLoaded === 0) {
    console.log("No .env files found in ~/.scottclip/ or .scottclip/ — relying on process env");
  }
}
