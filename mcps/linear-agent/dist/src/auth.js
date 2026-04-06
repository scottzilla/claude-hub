import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
const AGENT_DIR = process.env.LINEAR_AGENT_DIR || join(homedir(), ".linear-agent");
export const TOKEN_PATH = join(AGENT_DIR, "token.json");
const TOKEN_ENDPOINT = "https://api.linear.app/oauth/token";
const REFRESH_BUFFER_MS = 60 * 60 * 1000;
let cachedToken = null;
async function ensureDir() {
    await mkdir(AGENT_DIR, { recursive: true, mode: 0o700 });
}
async function loadCachedToken() {
    try {
        const raw = await readFile(TOKEN_PATH, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function persistToken(token) {
    await ensureDir();
    await writeFile(TOKEN_PATH, JSON.stringify(token, null, 2), { mode: 0o600 });
}
async function requestToken() {
    const clientId = process.env.LINEAR_CLIENT_ID;
    const clientSecret = process.env.LINEAR_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error("LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET must be set. " +
            "Create an OAuth app at https://linear.app/settings/api/applications");
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
        throw new Error(`Token request failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    const token = {
        access_token: data.access_token,
        expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
    await persistToken(token);
    return token;
}
function isExpiringSoon(token) {
    return new Date(token.expires_at).getTime() - Date.now() < REFRESH_BUFFER_MS;
}
export async function exchangeAuthCode(code, redirectUri) {
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
    const data = await res.json();
    const token = {
        access_token: data.access_token,
        expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
    await persistToken(token);
    cachedToken = token;
    return token;
}
export function getAuthUrl() {
    const clientId = process.env.LINEAR_CLIENT_ID;
    if (!clientId) {
        throw new Error("LINEAR_CLIENT_ID must be set.");
    }
    const port = process.env.WEBHOOK_PORT || "3847";
    const redirectUri = `http://localhost:${port}/oauth/callback`;
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "read,write,app:assignable,app:mentionable",
        actor: "app",
    });
    return `https://linear.app/oauth/authorize?${params}`;
}
export async function getAccessToken() {
    if (cachedToken && !isExpiringSoon(cachedToken)) {
        return cachedToken.access_token;
    }
    const stored = await loadCachedToken();
    if (stored && !isExpiringSoon(stored)) {
        cachedToken = stored;
        return stored.access_token;
    }
    cachedToken = await requestToken();
    return cachedToken.access_token;
}
export { AGENT_DIR };
