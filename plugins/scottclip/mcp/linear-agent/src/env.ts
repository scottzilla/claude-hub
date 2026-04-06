import { readFileSync } from "node:fs";
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
  const cwd = process.cwd();
  const envPath = join(cwd, ".scottclip", ".env");

  try {
    const content = readFileSync(envPath, "utf-8");
    const vars = parseDotEnv(content);

    let loaded = 0;
    for (const [key, value] of Object.entries(vars)) {
      // Do not override existing env vars (explicit env takes precedence)
      if (process.env[key] === undefined) {
        process.env[key] = value;
        loaded++;
      }
    }

    if (loaded > 0) {
      console.log(`Loaded ${loaded} env var(s) from ${envPath}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // .env file not found — not an error, just skip
      console.log(`No .scottclip/.env found in ${cwd} (this is fine for dev/manual mode)`);
    } else {
      console.error(`Error reading ${envPath}:`, err);
    }
  }
}
