import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

interface TokenData {
  access_token: string;
  expires_at: string;
  refresh_token?: string; // Present for authorization_code tokens, absent for client_credentials
}

const AGENT_DIR = process.env.LINEAR_AGENT_DIR || (process.env.AGENT_CWD ? join(process.env.AGENT_CWD, ".scottclip") : join(homedir(), ".scottclip"));
export const TOKEN_PATH = join(AGENT_DIR, "token.json");
const TOKEN_ENDPOINT = "https://api.linear.app/oauth/token";
const REFRESH_BUFFER_MS = 60 * 60 * 1000;

let cachedToken: TokenData | null = null;

async function ensureDir(): Promise<void> {
  await mkdir(AGENT_DIR, { recursive: true });
}

async function loadCachedToken(): Promise<TokenData | null> {
  try {
    const raw = await readFile(TOKEN_PATH, "utf-8");
    return JSON.parse(raw) as TokenData;
  } catch {
    return null;
  }
}

async function persistToken(token: TokenData): Promise<void> {
  await ensureDir();
  await writeFile(TOKEN_PATH, JSON.stringify(token, null, 2));
}

async function requestToken(): Promise<TokenData> {
  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET must be set. " +
      "Create an OAuth app at https://linear.app/settings/api/applications"
    );
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      actor: "app",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (body.includes("client_credentials")) {
      throw new Error(
        "This Linear OAuth app does not support client_credentials grant. " +
        "Authorize via browser instead: start the server (npm run start) " +
        "and open the authorization URL printed at startup."
      );
    }
    throw new Error(`Token request failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  const token: TokenData = {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };

  await persistToken(token);
  return token;
}

function isExpiringSoon(token: TokenData): boolean {
  return new Date(token.expires_at).getTime() - Date.now() < REFRESH_BUFFER_MS;
}

export async function exchangeAuthCode(code: string, redirectUri: string): Promise<TokenData> {
  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET must be set.");
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number; refresh_token?: string };
  const token: TokenData = {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    ...(data.refresh_token && { refresh_token: data.refresh_token }),
  };

  await persistToken(token);
  cachedToken = token;
  return token;
}

async function refreshToken(token: TokenData): Promise<TokenData> {
  if (!token.refresh_token) {
    throw new Error("No refresh token available");
  }

  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET must be set.");
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number; refresh_token?: string };
  const newToken: TokenData = {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    // Use new refresh token if provided, otherwise keep the old one
    refresh_token: data.refresh_token || token.refresh_token,
  };

  await persistToken(newToken);
  cachedToken = newToken;
  console.error("Token refreshed successfully");
  return newToken;
}

export function getAuthUrl(): string {
  const clientId = process.env.LINEAR_CLIENT_ID;
  if (!clientId) {
    throw new Error("LINEAR_CLIENT_ID must be set.");
  }
  const callbackHost = process.env.LINEAR_CALLBACK_HOST || `http://localhost:${process.env.WEBHOOK_PORT || "3847"}`;
  const redirectUri = `${callbackHost}/oauth/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "read,write,app:assignable,app:mentionable",
    actor: "app",
  });
  return `https://linear.app/oauth/authorize?${params}`;
}

export function getCallbackUrl(): string {
  const callbackHost = process.env.LINEAR_CALLBACK_HOST || `http://localhost:${process.env.WEBHOOK_PORT || "3847"}`;
  return `${callbackHost}/oauth/callback`;
}

export async function getAccessToken(): Promise<string> {
  // Check in-memory cache
  if (cachedToken && !isExpiringSoon(cachedToken)) {
    return cachedToken.access_token;
  }

  // Check file cache
  const stored = await loadCachedToken();
  if (stored && !isExpiringSoon(stored)) {
    cachedToken = stored;
    return stored.access_token;
  }

  // Token expired or expiring — try refresh first (authorization_code tokens)
  if (stored?.refresh_token) {
    try {
      const refreshed = await refreshToken(stored);
      return refreshed.access_token;
    } catch (err) {
      console.error("Token refresh failed, falling back to client_credentials:", err);
    }
  }

  // No token at all — try client_credentials, but give a clear error if it fails
  try {
    cachedToken = await requestToken();
    return cachedToken.access_token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("client_credentials")) {
      throw new Error(
        "No valid token found. Authorize via browser: " +
        "start the server (npm run start) and visit the auth URL, " +
        "or run /scottclip-init which will open the browser for you."
      );
    }
    throw err;
  }
}

export { AGENT_DIR };
