import { Hono } from "hono";
import { exchangeAuthCode, getAuthUrl, getCallbackUrl } from "./auth.js";

export function createOAuthRoute(): Hono {
  const app = new Hono();

  app.get("/callback", async (c) => {
    const error = c.req.query("error");
    if (error) {
      console.error(`OAuth error: ${error}`);
      return c.html(`<h1>Authorization failed</h1><p>${error}</p><p>Close this tab and try again.</p>`, 400);
    }

    const code = c.req.query("code");
    if (!code) {
      return c.html(`<h1>Missing authorization code</h1><p>Close this tab and try again.</p>`, 400);
    }

    try {
      const redirectUri = getCallbackUrl();
      await exchangeAuthCode(code, redirectUri);
      console.log("OAuth authorization successful — token saved");
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
      authLink
    );
  });

  return app;
}
