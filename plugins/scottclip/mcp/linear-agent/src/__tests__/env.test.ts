import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDotEnv } from "../env.js";

describe("parseDotEnv", () => {
  it("parses KEY=VALUE lines", () => {
    const content = `
LINEAR_CLIENT_ID=abc123
LINEAR_CLIENT_SECRET=secret456
`;
    const result = parseDotEnv(content);

    expect(result).toEqual({
      LINEAR_CLIENT_ID: "abc123",
      LINEAR_CLIENT_SECRET: "secret456",
    });
  });

  it("ignores comments and blank lines", () => {
    const content = `
# This is a comment
LINEAR_CLIENT_ID=abc123

  # Another comment
LINEAR_CLIENT_SECRET=secret456
`;
    const result = parseDotEnv(content);

    expect(result).toEqual({
      LINEAR_CLIENT_ID: "abc123",
      LINEAR_CLIENT_SECRET: "secret456",
    });
  });

  it("handles quoted values and strips quotes", () => {
    const content = `
LINEAR_CLIENT_ID="abc123"
LINEAR_CLIENT_SECRET='secret456'
`;
    const result = parseDotEnv(content);

    expect(result).toEqual({
      LINEAR_CLIENT_ID: "abc123",
      LINEAR_CLIENT_SECRET: "secret456",
    });
  });

  it("does not override existing env vars", () => {
    const content = `KEY=from_file`;
    const result = parseDotEnv(content);
    expect(result).toEqual({ KEY: "from_file" });
  });

  it("handles values with = signs", () => {
    const content = `DATABASE_URL=postgres://user:pass@host/db?ssl=true`;
    const result = parseDotEnv(content);
    expect(result).toEqual({
      DATABASE_URL: "postgres://user:pass@host/db?ssl=true",
    });
  });
});

describe("loadDotEnv — global home", () => {
  let homeDir: string;
  const KEYS = ["LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET", "TEST_MARKER"];

  beforeEach(() => {
    vi.resetModules();
    homeDir = mkdtempSync(join(tmpdir(), "sc-env-"));
    process.env.SCOTTCLIP_HOME = homeDir;
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    delete process.env.SCOTTCLIP_HOME;
    for (const k of KEYS) delete process.env[k];
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("loads ~/.scottclip/.env when present", async () => {
    writeFileSync(join(homeDir, ".env"), "TEST_MARKER=from_global\n");
    const { loadDotEnv } = await import("../env.js");
    loadDotEnv();
    expect(process.env.TEST_MARKER).toBe("from_global");
  });

  it("global takes precedence over per-repo legacy when both present", async () => {
    writeFileSync(join(homeDir, ".env"), "TEST_MARKER=from_global\n");
    const repoDir = mkdtempSync(join(tmpdir(), "sc-repo-"));
    mkdirSync(join(repoDir, ".scottclip"), { recursive: true });
    writeFileSync(join(repoDir, ".scottclip", ".env"), "TEST_MARKER=from_repo\n");
    const origCwd = process.cwd();
    process.chdir(repoDir);
    try {
      const { loadDotEnv } = await import("../env.js");
      loadDotEnv();
      expect(process.env.TEST_MARKER).toBe("from_global");
    } finally {
      process.chdir(origCwd);
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("falls back to per-repo .scottclip/.env when global missing", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "sc-repo-"));
    mkdirSync(join(repoDir, ".scottclip"), { recursive: true });
    writeFileSync(join(repoDir, ".scottclip", ".env"), "TEST_MARKER=from_repo\n");
    const origCwd = process.cwd();
    process.chdir(repoDir);
    try {
      const { loadDotEnv } = await import("../env.js");
      loadDotEnv();
      expect(process.env.TEST_MARKER).toBe("from_repo");
    } finally {
      process.chdir(origCwd);
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
