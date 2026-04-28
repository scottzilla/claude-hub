import { Hono } from "hono";
import { createHmac, randomBytes } from "node:crypto";
import { exchangeAuthCode, getAuthUrl, getCallbackUrl } from "./auth.js";
import { list as listTeams } from "./registry.js";

interface StatePayload {
  cwd: string;
  organizationId: string;
  nonce: string;
  exp: number;
}

export function signState(
  input: { cwd: string; organizationId: string },
  secret: string,
  opts: { ttlMs?: number } = {},
): string {
  const ttl = opts.ttlMs ?? 10 * 60 * 1000;
  const payload: StatePayload = {
    cwd: input.cwd,
    organizationId: input.organizationId,
    nonce: randomBytes(8).toString("hex"),
    exp: Date.now() + ttl,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export type StateVerifyResult =
  | { ok: true; payload: StatePayload }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

export function verifyState(state: string, secret: string): StateVerifyResult {
  const dot = state.indexOf(".");
  if (dot < 0) return { ok: false, reason: "malformed" };
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (sig.length !== expected.length) return { ok: false, reason: "bad-signature" };
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: "bad-signature" };
  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as StatePayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}

const ORG_QUERY = `query Organization { organization { id name urlKey } }`;

async function fetchOrganizationId(): Promise<string> {
  const { gql } = await import("./graphql.js");
  const data = await gql<{ organization: { id: string } }>(ORG_QUERY);
  return data.organization.id;
}

export function createOAuthRoute(): Hono {
  const app = new Hono();

  app.get("/callback", async (c) => {
    const error = c.req.query("error");
    if (error) {
      console.error(`OAuth error: ${error}`);
      return c.html(`<h1>Authorization failed</h1><p>${error}</p>`, 400);
    }

    const code = c.req.query("code");
    if (!code) {
      return c.html(`<h1>Missing authorization code</h1>`, 400);
    }

    const state = c.req.query("state");
    const secret = process.env.LINEAR_CLIENT_SECRET;
    if (!secret) {
      return c.html(`<h1>Server misconfigured</h1><p>LINEAR_CLIENT_SECRET not set.</p>`, 500);
    }

    let statePayload: StatePayload | null = null;
    if (state) {
      const verified = verifyState(state, secret);
      if (!verified.ok) {
        console.error(`OAuth state verification failed: ${verified.reason}`);
        return c.html(`<h1>State verification failed</h1><p>${verified.reason}</p>`, 400);
      }
      statePayload = verified.payload;
    }

    try {
      const redirectUri = getCallbackUrl();
      await exchangeAuthCode(code, redirectUri);
      console.log("OAuth authorization successful — token saved to ~/.scottclip/token.json");

      // Verify single-workspace invariant + report org
      if (statePayload) {
        const orgIdFromLinear = await fetchOrganizationId();
        const existing = listTeams();
        const conflict = existing.find((e) => e.organizationId !== orgIdFromLinear);
        if (conflict) {
          return c.html(
            `<h1>Workspace mismatch</h1><p>This server already serves workspace <code>${conflict.organizationId}</code> — refusing to add ${orgIdFromLinear}.</p>`,
            409,
          );
        }
        console.log(`OAuth bound to organizationId=${orgIdFromLinear} (cwd ${statePayload.cwd})`);
      }

      return c.html(`<h1>Authorized!</h1><p>Token saved. You can close this tab and return to Claude Code.</p>`);
    } catch (err) {
      console.error("OAuth token exchange failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      return c.html(`<h1>Token exchange failed</h1><p>${message}</p>`, 500);
    }
  });

  return app;
}

export function createStatusRoute(): Hono {
  const app = new Hono();
  app.get("/", (c) => {
    let authLink = "";
    try {
      const authUrl = getAuthUrl();
      authLink = `<p><a href="${authUrl}">Authorize with Linear</a></p>`;
    } catch {
      authLink = `<p>OAuth unavailable (LINEAR_CLIENT_ID not set)</p>`;
    }
    return c.html(
      `<h1>ScottClip Linear Agent</h1>` +
        `<p>MCP server running on port ${process.env.WEBHOOK_PORT || "3847"}</p>` +
        `<p>Routes: /mcp, /webhook, /oauth/callback</p>` +
        authLink,
    );
  });
  return app;
}
