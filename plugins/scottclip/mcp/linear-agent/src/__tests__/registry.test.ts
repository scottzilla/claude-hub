import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "sc-registry-"));
  process.env.SCOTTCLIP_HOME = homeDir;
});

afterEach(() => {
  delete process.env.SCOTTCLIP_HOME;
  rmSync(homeDir, { recursive: true, force: true });
});

describe("registry — empty state", () => {
  it("list() returns empty array when registry file does not exist", async () => {
    const { list } = await import("../registry.js");
    expect(list()).toEqual([]);
  });

  it("lookup() returns null for unknown teamId", async () => {
    const { lookup } = await import("../registry.js");
    expect(lookup("team-does-not-exist")).toBeNull();
  });
});

describe("registry — register/lookup", () => {
  it("register persists an entry and lookup returns it", async () => {
    const { register, lookup } = await import("../registry.js");
    const entry = register({
      teamId: "team-a",
      cwd: "/repo/a",
      configPath: "/repo/a/.scottclip/config.yaml",
      organizationId: "org-1",
    });
    expect(entry.teamId).toBe("team-a");
    expect(typeof entry.registeredAt).toBe("string");
    expect(entry.lastEventAt).toBeNull();

    const found = lookup("team-a");
    expect(found).not.toBeNull();
    expect(found!.cwd).toBe("/repo/a");
    expect(found!.organizationId).toBe("org-1");
  });

  it("registry file is created with mode 0600", async () => {
    const { register } = await import("../registry.js");
    register({
      teamId: "team-a",
      cwd: "/repo/a",
      configPath: "/repo/a/.scottclip/config.yaml",
      organizationId: "org-1",
    });
    const stat = (await import("node:fs")).statSync(join(homeDir, "registry.json"));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("re-registering same teamId preserves registeredAt and updates fields", async () => {
    const { register, lookup } = await import("../registry.js");
    const first = register({
      teamId: "team-a",
      cwd: "/repo/a",
      configPath: "/repo/a/.scottclip/config.yaml",
      organizationId: "org-1",
    });
    await new Promise((r) => setTimeout(r, 10));
    register({
      teamId: "team-a",
      cwd: "/repo/a-renamed",
      configPath: "/repo/a-renamed/.scottclip/config.yaml",
      organizationId: "org-1",
    });
    const found = lookup("team-a")!;
    expect(found.cwd).toBe("/repo/a-renamed");
    expect(found.registeredAt).toBe(first.registeredAt);
  });
});

describe("registry — concurrency", () => {
  it("two parallel registers both land", async () => {
    const { register, list } = await import("../registry.js");
    await Promise.all([
      Promise.resolve(register({
        teamId: "team-a",
        cwd: "/repo/a",
        configPath: "/repo/a/.scottclip/config.yaml",
        organizationId: "org-1",
      })),
      Promise.resolve(register({
        teamId: "team-b",
        cwd: "/repo/b",
        configPath: "/repo/b/.scottclip/config.yaml",
        organizationId: "org-1",
      })),
    ]);
    const entries = list();
    expect(entries.map((e) => e.teamId).sort()).toEqual(["team-a", "team-b"]);
  });

  it("stale lock (>5s old) is taken over", async () => {
    const fs = await import("node:fs");
    const lp = join(homeDir, "registry.lock");
    fs.writeFileSync(lp, String(99999));
    const tenSecAgo = new Date(Date.now() - 10000);
    fs.utimesSync(lp, tenSecAgo, tenSecAgo);

    const { register, lookup } = await import("../registry.js");
    register({
      teamId: "team-a",
      cwd: "/repo/a",
      configPath: "/repo/a/.scottclip/config.yaml",
      organizationId: "org-1",
    });
    expect(lookup("team-a")).not.toBeNull();
  });

  it("remove() deletes a team entry", async () => {
    const { register, remove, lookup } = await import("../registry.js");
    register({
      teamId: "team-a",
      cwd: "/repo/a",
      configPath: "/repo/a/.scottclip/config.yaml",
      organizationId: "org-1",
    });
    remove("team-a");
    expect(lookup("team-a")).toBeNull();
  });

  it("touch() updates lastEventAt", async () => {
    const { register, touch, lookup } = await import("../registry.js");
    register({
      teamId: "team-a",
      cwd: "/repo/a",
      configPath: "/repo/a/.scottclip/config.yaml",
      organizationId: "org-1",
    });
    expect(lookup("team-a")!.lastEventAt).toBeNull();
    touch("team-a");
    expect(lookup("team-a")!.lastEventAt).not.toBeNull();
  });
});
