import { describe, it, expect } from "vitest";
import { signState, verifyState } from "../oauth.js";

const SECRET = "test-client-secret-abc";

describe("oauth state — sign/verify", () => {
  it("verifies a freshly-signed state", () => {
    const state = signState({ cwd: "/repo/a", organizationId: "org-1" }, SECRET);
    const result = verifyState(state, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.cwd).toBe("/repo/a");
      expect(result.payload.organizationId).toBe("org-1");
    }
  });

  it("rejects a state signed with a different secret", () => {
    const state = signState({ cwd: "/repo/a", organizationId: "org-1" }, SECRET);
    const result = verifyState(state, "different-secret");
    expect(result.ok).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const state = signState({ cwd: "/repo/a", organizationId: "org-1" }, SECRET);
    const [b64, sig] = state.split(".");
    const tampered = Buffer.from(b64, "base64url").toString("utf-8").replace("/repo/a", "/evil");
    const reencoded = Buffer.from(tampered, "utf-8").toString("base64url");
    const result = verifyState(`${reencoded}.${sig}`, SECRET);
    expect(result.ok).toBe(false);
  });

  it("rejects an expired state", () => {
    const state = signState(
      { cwd: "/repo/a", organizationId: "org-1" },
      SECRET,
      { ttlMs: -1000 },
    );
    const result = verifyState(state, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("includes a unique nonce for each call", () => {
    const a = signState({ cwd: "/repo/a", organizationId: "org-1" }, SECRET);
    const b = signState({ cwd: "/repo/a", organizationId: "org-1" }, SECRET);
    expect(a).not.toBe(b);
  });
});
