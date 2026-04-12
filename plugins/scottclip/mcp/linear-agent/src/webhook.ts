import { Hono } from "hono";
import { createHmac } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ackSession, spawnClaudeSession, moveIssueToState } from "./spawn.js";

function readConfigRaw(): string | null {
  const agentCwd = process.env.AGENT_CWD || process.cwd();
  try {
    return readFileSync(join(agentCwd, ".scottclip", "config.yaml"), "utf-8");
  } catch {
    return null;
  }
}

function getConfiguredTeamId(): string | null {
  const raw = readConfigRaw();
  if (!raw) return null;
  const match = raw.match(/^\s*team_id:\s*"?([^"\n]+)"?/m);
  return match ? match[1].trim() : null;
}

export interface AutoReactConfig {
  autoReact: boolean;
  quietWindowS: number;
}

export function getAutoReactConfig(raw?: string): AutoReactConfig {
  const defaults: AutoReactConfig = { autoReact: false, quietWindowS: 30 };
  const content = raw ?? readConfigRaw();
  if (!content) return defaults;

  const autoReactMatch = content.match(/^\s*auto_react:\s*(true|false)/m);
  const quietWindowMatch = content.match(/^\s*quiet_window_s:\s*(\d+)/m);

  return {
    autoReact: autoReactMatch ? autoReactMatch[1] === "true" : defaults.autoReact,
    quietWindowS: quietWindowMatch ? parseInt(quietWindowMatch[1], 10) : defaults.quietWindowS,
  };
}

export type IssueEventAction = "create" | "label_change" | "state_to_todo" | "skip";

export function classifyIssueEvent(event: Record<string, unknown>): IssueEventAction {
  const actor = event.actor as Record<string, unknown> | undefined;
  const action = event.action as string;
  const data = event.data as Record<string, unknown> | undefined;
  const updatedFrom = event.updatedFrom as Record<string, unknown> | undefined;

  // Bot guard — skip events from apps/agents
  if (actor?.type === "app") return "skip";

  // Issue created by human
  if (action === "create") return "create";

  // Issue updated — check what changed
  if (action === "update" && updatedFrom) {
    // Label changed
    if ("labelIds" in updatedFrom) return "label_change";

    // State changed to Todo
    if ("stateId" in updatedFrom) {
      const state = (data?.state as Record<string, unknown>)?.name;
      if (state === "Todo") return "state_to_todo";
    }
  }

  return "skip";
}

export interface DebouncedHeartbeat {
  queue(eventId: string): void;
  setRunning(running: boolean): void;
}

export function createDebouncedHeartbeat(
  quietWindowS: number,
  onFire: (eventCount: number) => void,
): DebouncedHeartbeat {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let eventCount = 0;
  let running = false;

  return {
    queue(eventId: string) {
      if (running) {
        console.log(`Debounce: skipping (heartbeat running), event ${eventId}`);
        return;
      }
      eventCount++;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const count = eventCount;
        eventCount = 0;
        timer = null;
        onFire(count);
      }, quietWindowS * 1000);
      console.log(`Debounce: queued event ${eventId} (${eventCount} pending, ${quietWindowS}s window)`);
    },
    setRunning(r: boolean) {
      running = r;
    },
  };
}

export function verifySignature(
  body: string,
  signature: string | null,
  secret: string | undefined
): boolean {
  if (!secret) return false;
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const match = signature === expected;
  if (!match) {
    console.error(
      `Signature mismatch — expected: ${expected.substring(0, 16)}..., got: ${signature.substring(0, 16)}...`
    );
  }
  return match;
}

export function createWebhookRoute(): Hono {
  const app = new Hono();

  // Auto-react debounce — fires heartbeat after quiet window
  const debouncer = createDebouncedHeartbeat(
    getAutoReactConfig().quietWindowS,
    (eventCount) => {
      console.log(`Auto-react: firing heartbeat (${eventCount} events in window)`);
      debouncer.setRunning(true);
      const syntheticEvent: Record<string, unknown> = {
        type: "AutoReactHeartbeat",
        action: "created",
        data: {
          id: `auto-react-${Date.now()}`,
          issueIdentifier: "heartbeat",
        },
        guidance: "Auto-react triggered by Issue webhook events. Run a heartbeat cycle: pick up issues from the inbox, triage unlabeled ones, dispatch to personas.",
        promptContext: `Triggered by ${eventCount} Issue event(s).`,
      };
      spawnClaudeSession(syntheticEvent)
        .catch((err) => console.error("Auto-react spawn error:", err))
        .finally(() => debouncer.setRunning(false));
    },
  );

  app.post("/", async (c) => {
    const secret = process.env.LINEAR_WEBHOOK_SECRET;
    const body = await c.req.text();
    const signature = c.req.header("linear-signature") ?? null;

    if (!verifySignature(body, signature, secret)) {
      console.error("Invalid webhook signature");
      return c.text("Invalid signature", 401);
    }

    try {
      const event = JSON.parse(body);

      console.log(`Event received: ${event.type || "unknown"} (${event.action || "?"})`);

      // Respond 200 immediately, then handle async work
      const response = c.text("OK", 200);

      if (event.type === "AgentSessionEvent") {
        const sessionData = event.agentSession || event.data;
        if (!sessionData?.id) return response;

        const sessionId = sessionData.id as string;

        // Debug: log creator info to diagnose self-triggering
        const creatorDebug = sessionData.creator as Record<string, unknown> | undefined;
        if (creatorDebug) {
          console.log(`Session ${sessionId} creator: ${JSON.stringify({ id: creatorDebug.id, name: creatorDebug.name, isBot: creatorDebug.isBot, type: creatorDebug.type })}`);
        }

        // Stop signal first — don't do any other work
        const signal = event.agentActivity?.signal;
        if (signal === "stop") {
          console.log(`Stop signal received for session ${sessionId}`);
          const agentCwd = process.env.AGENT_CWD || process.cwd();
          const sessionsDir = join(agentCwd, ".scottclip", "sessions");
          const sessionFile = join(sessionsDir, `${sessionId}.pid`);
          try {
            const pid = parseInt(await readFile(sessionFile, "utf-8"), 10);
            if (pid) {
              process.kill(pid, "SIGTERM");
              console.log(`Killed session ${sessionId} (PID ${pid})`);
            }
            await unlink(sessionFile);
          } catch {
            console.log(`No active session file for ${sessionId} (may have already finished)`);
          }
          return response;
        }

        // Team filter — skip events for other teams
        const configuredTeamId = getConfiguredTeamId();
        const issueTeamId = sessionData.issue?.teamId || sessionData.issue?.team?.id;
        if (configuredTeamId && issueTeamId && issueTeamId !== configuredTeamId) {
          console.log(`Ignoring event for team ${issueTeamId} (configured: ${configuredTeamId})`);
          return response;
        }

        // Skip events triggered by the bot itself (prevents comment → session → comment loop)
        const creator = sessionData.creator as Record<string, unknown> | undefined;
        const creatorIsBot = creator?.isBot === true || creator?.type === "application";
        if (creatorIsBot) {
          console.log(`Ignoring bot-triggered session ${sessionId} (creator: ${JSON.stringify({ id: creator?.id, name: creator?.name, type: creator?.type })})`);
          return response;
        }

        if (event.action === "created" || event.action === "prompted") {
          // Ack FIRST (must respond within 5s), then move to In Progress, then spawn
          const ackMsg = event.action === "created" ? "Starting up..." : "Reading your message...";
          ackSession(sessionId, ackMsg).catch((err) =>
            console.error("Ack error:", err)
          );

          // Move issue to In Progress
          const issueId = sessionData.issue?.id;
          const teamId = issueTeamId || configuredTeamId;
          if (issueId && teamId) {
            moveIssueToState(issueId as string, teamId as string, "In Progress").catch((err) =>
              console.error("Move to In Progress error:", err)
            );
          }

          spawnClaudeSession(event).catch((err) => console.error("Spawn error:", err));
        }
      }

      // --- Issue event handler (auto_react) ---
      if (event.type === "Issue") {
        const config = getAutoReactConfig();
        if (config.autoReact) {
          // Team filter
          const configuredTeamId = getConfiguredTeamId();
          const issueTeamId = (event.data as Record<string, unknown>)?.teamId as string | undefined;
          if (configuredTeamId && issueTeamId && issueTeamId !== configuredTeamId) {
            console.log(`Auto-react: ignoring Issue event for team ${issueTeamId}`);
            return response;
          }

          const classification = classifyIssueEvent(event);
          if (classification !== "skip") {
            console.log(`Auto-react: ${classification} event, queuing heartbeat`);
            debouncer.queue(`${event.action}-${(event.data as Record<string, unknown>)?.id || "unknown"}`);
          }
        }
      }

      return response;
    } catch (err) {
      console.error("Failed to process webhook:", err);
      return c.text("Internal error", 500);
    }
  });

  return app;
}
