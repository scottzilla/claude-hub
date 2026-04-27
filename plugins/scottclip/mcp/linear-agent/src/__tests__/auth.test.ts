import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let homeDir: string;
let repoDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "sc-auth-home-"));
  repoDir = mkdtempSync(join(tmpdir(), "sc-auth-repo-"));
  process.env.SCOTTCLIP_HOME = homeDir;
  process.env.AGENT_CWD = repoDir;
  delete process.env.LINEAR_AGENT_DIR;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.SCOTTCLIP_HOME;
  delete process.env.AGENT_CWD;
  rmSync(homeDir, { recursive: true, force: true });
  rmSync(repoDir, { recursive: true, force: true });
});

describe("auth — global token path", () => {
  it("TOKEN_PATH points at ~/.scottclip/token.json", async () => {
    const { TOKEN_PATH } = await import("../auth.js");
    expect(TOKEN_PATH).toBe(join(homeDir, "token.json"));
  });

  it("migrates legacy repo-local token.json to global on first read", async () => {
    mkdirSync(join(repoDir, ".scottclip"), { recursive: true });
    const legacyToken = {
      access_token: "legacy-abc",
      expires_at: new Date(Date.now() + 7200_000).toISOString(),
      refresh_token: "ref-123",
    };
    writeFileSync(
      join(repoDir, ".scottclip", "token.json"),
      JSON.stringify(legacyToken),
    );

    const { getAccessToken, TOKEN_PATH } = await import("../auth.js");
    const access = await getAccessToken();
    expect(access).toBe("legacy-abc");
    expect(existsSync(TOKEN_PATH)).toBe(true);
    const persisted = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
    expect(persisted.access_token).toBe("legacy-abc");
  });

  it("uses global token when present, ignoring legacy repo token", async () => {
    writeFileSync(
      join(homeDir, "token.json"),
      JSON.stringify({
        access_token: "global-xyz",
        expires_at: new Date(Date.now() + 7200_000).toISOString(),
      }),
    );
    mkdirSync(join(repoDir, ".scottclip"), { recursive: true });
    writeFileSync(
      join(repoDir, ".scottclip", "token.json"),
      JSON.stringify({
        access_token: "should-not-be-used",
        expires_at: new Date(Date.now() + 7200_000).toISOString(),
      }),
    );
    const { getAccessToken } = await import("../auth.js");
    const access = await getAccessToken();
    expect(access).toBe("global-xyz");
  });
});
