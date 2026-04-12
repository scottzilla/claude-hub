import { describe, it, expect } from "vitest";
import { verifySignature, getAutoReactConfig } from "../webhook.js";
import { createHmac } from "node:crypto";

describe("verifySignature", () => {
  const secret = "test-webhook-secret-12345";

  it("returns true for a valid HMAC-SHA256 signature", () => {
    const body = '{"type":"AgentSessionEvent","action":"created"}';
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    expect(verifySignature(body, signature, secret)).toBe(true);
  });

  it("returns false for an invalid signature", () => {
    const body = '{"type":"AgentSessionEvent","action":"created"}';
    const signature = "0000000000000000000000000000000000000000000000000000000000000000";

    expect(verifySignature(body, signature, secret)).toBe(false);
  });

  it("returns false when signature is null", () => {
    const body = '{"some":"data"}';

    expect(verifySignature(body, null, secret)).toBe(false);
  });

  it("returns false when secret is undefined", () => {
    const body = '{"some":"data"}';
    const signature = "anything";

    expect(verifySignature(body, signature, undefined)).toBe(false);
  });
});

describe("getAutoReactConfig", () => {
  it("returns defaults when config has no monitor section", () => {
    const config = getAutoReactConfig("version: 2\nlinear:\n  team: test\n");
    expect(config).toEqual({ autoReact: false, quietWindowS: 30 });
  });

  it("reads auto_react and quiet_window_s from config", () => {
    const config = getAutoReactConfig(
      "version: 2\nmonitor:\n  auto_react: true\n  quiet_window_s: 15\n"
    );
    expect(config).toEqual({ autoReact: true, quietWindowS: 15 });
  });

  it("returns defaults for partial config", () => {
    const config = getAutoReactConfig("version: 2\nmonitor:\n  auto_react: true\n");
    expect(config).toEqual({ autoReact: true, quietWindowS: 30 });
  });
});
