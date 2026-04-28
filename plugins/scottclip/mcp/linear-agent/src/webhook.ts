import { Hono } from "hono";
import { createHmac, randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ackSession, spawnClaudeSession, moveIssueToState } from "./spawn.js";
import type { RepoContext } from "./repo-context.js";
import { lookup as registryLookup, list as registryList, touch as registryTouch } from "./registry.js";
import { extractTeamId } from "./repo-context.js";
import { resolveSessionMapping, commitMapping, ccFilePath } from "./session-store.js";

export interface AutoReactConfig {
  autoReact: boolean;
  quietWindowS: number;
}

export function getAutoReactConfig(raw: string | undefined): AutoReactConfig {
  const defaults: AutoReactConfig = { autoReact: false, quietWindowS: 30 };
  if (!raw) return defaults;
  const autoReactMatch = raw.match(/^\s*auto_react:\s*(true|false)/m);
  const quietWindowMatch = raw.match(/^\s*quiet_window_s:\s*(\d+)/m);
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

function buildRepoContext(event: Record<string, unknown>): RepoContext | "unknown-team" | "no-team-id" {
  const teamId = extractTeamId(event);
  const registryPopulated = registryList().length > 0;

  if (registryPopulated) {
    if (!teamId) return "no-team-id";
    const entry = registryLookup(teamId);
    if (!entry) return "unknown-team";
    // Defer the touch off the request hot path — lastEventAt is informational
    setImmediate(() => {
      try {
        registryTouch(teamId);
      } catch (err) {
        console.error("registryTouch error:", err);
      }
    });
    return {
      teamId: entry.teamId,
      cwd: entry.cwd,
      configPath: entry.configPath,
      organizationId: entry.organizationId,
    };
  }

  // Legacy fallback — registry empty/missing
  const cwd = process.env.AGENT_CWD || process.cwd();
  const eventTeamId = extractTeamId(event);
  return {
    teamId: eventTeamId ?? "legacy",
    cwd,
    configPath: join(cwd, ".scottclip", "config.yaml"),
    organizationId: "legacy",
  };
}

export function createWebhookRoute(): Hono {
  const app = new Hono();

  // Per-team auto-react debouncers
  const debouncers = new Map<string, DebouncedHeartbeat>();
  // sessionId → teamId map for stop-signal routing (used only if Branch B)
  const sessionTeamMap = new Map<string, string>();

  function getDebouncer(ctx: RepoContext): DebouncedHeartbeat {
    const existing = debouncers.get(ctx.teamId);
    if (existing) return existing;
    const cfgRaw = (() => {
      try { return readFileSync(ctx.configPath, "utf-8"); } catch { return undefined; }
    })();
    const cfg = getAutoReactConfig(cfgRaw);
    const d = createDebouncedHeartbeat(cfg.quietWindowS, (eventCount) => {
      console.log(`Auto-react[${ctx.teamId}]: firing heartbeat (${eventCount} events in window)`);
      d.setRunning(true);
      const syntheticEvent: Record<string, unknown> = {
        type: "AutoReactHeartbeat",
        action: "created",
        data: { id: `auto-react-${Date.now()}`, issueIdentifier: "heartbeat" },
        guidance: "Auto-react triggered by Issue webhook events. Run a heartbeat cycle: pick up issues from the inbox, triage unlabeled ones, dispatch to personas.",
        promptContext: `Triggered by ${eventCount} Issue event(s) for team ${ctx.teamId}.`,
      };
      spawnClaudeSession(syntheticEvent, ctx, { sessionMap: sessionTeamMap })
        .catch((err) => console.error("Auto-react spawn error:", err))
        .finally(() => d.setRunning(false));
    });
    debouncers.set(ctx.teamId, d);
    return d;
  }

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

        const creatorDebug = sessionData.creator as Record<string, unknown> | undefined;
        if (creatorDebug) {
          console.log(`Session ${sessionId} creator: ${JSON.stringify({ id: creatorDebug.id, name: creatorDebug.name, isBot: creatorDebug.isBot, type: creatorDebug.type })}`);
        }

        // Skip bot-triggered sessions
        const creator = sessionData.creator as Record<string, unknown> | undefined;
        const creatorIsBot = creator?.isBot === true || creator?.type === "application";
        if (creatorIsBot) {
          console.log(`Ignoring bot-triggered session ${sessionId}`);
          return response;
        }

        // Resolve repo context once — reused by both stop and created/prompted paths
        const ctxOrSentinel = buildRepoContext(event);

        // Stop signal — route via registry OR sessionTeamMap depending on payload
        const signal = (event.agentActivity as Record<string, unknown> | undefined)?.signal;
        if (signal === "stop") {
          console.log(`Stop signal received for session ${sessionId}`);
          // Defensive: try registry path first; if no teamId on event, fall back to sessionTeamMap.
          let resolved = ctxOrSentinel;
          if (resolved === "no-team-id") {
            const mapped = sessionTeamMap.get(sessionId);
            if (mapped) {
              const entry = registryLookup(mapped);
              if (entry) resolved = { teamId: entry.teamId, cwd: entry.cwd, configPath: entry.configPath, organizationId: entry.organizationId };
            }
          }
          if (typeof resolved === "string") {
            console.log(`Stop signal for ${sessionId}: cannot resolve team (${resolved}) — ignoring`);
            return response;
          }
          const sessionsDir = join(resolved.cwd, ".scottclip", "sessions");
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
          sessionTeamMap.delete(sessionId);
          return response;
        }

        if (ctxOrSentinel === "unknown-team") {
          console.log(`Ignoring AgentSessionEvent for unregistered team (session ${sessionId})`);
          return response;
        }
        if (ctxOrSentinel === "no-team-id") {
          console.log(`Ignoring AgentSessionEvent without teamId (session ${sessionId})`);
          return response;
        }
        const ctx = ctxOrSentinel;

        if (event.action === "created" || event.action === "prompted") {
          const ackMsg = event.action === "created" ? "Starting up..." : "Reading your message...";
          ackSession(sessionId, ackMsg).catch((err) => console.error("Ack error:", err));

          const issueId = sessionData.issue?.id;
          if (issueId) {
            moveIssueToState(issueId as string, ctx.teamId, "In Progress").catch((err) =>
              console.error("Move to In Progress error:", err),
            );
          }

          resolveSessionMapping(ctx.cwd, sessionId).then(async (resolved) => {
            const resumeOpts = resolved.mode === "resume"
              ? { resume: resolved.info.resume }
              : { sessionId: resolved.info.sessionId };

            const ccId = resolved.mode === "resume"
              ? resolved.info.resume
              : resolved.info.sessionId;

            try {
              await spawnClaudeSession(event, ctx, {
                sessionMap: sessionTeamMap,
                ...resumeOpts,
              });
              await commitMapping(ctx.cwd, sessionId, ccId);
            } catch (err) {
              if (resolved.mode === "resume") {
                console.error(`Resume failed for session ${sessionId} (cc: ${ccId}), falling back to cold spawn:`, err);
                await unlink(ccFilePath(ctx.cwd, sessionId)).catch(() => undefined);
                const freshSessionId = randomUUID();
                await spawnClaudeSession(event, ctx, {
                  sessionMap: sessionTeamMap,
                  sessionId: freshSessionId,
                });
                await commitMapping(ctx.cwd, sessionId, freshSessionId);
              } else {
                throw err;
              }
            }
          }).catch((err) => console.error("Spawn error:", err));
        }
      }

      // --- Issue event handler (auto_react) ---
      if (event.type === "Issue") {
        const ctxOrSentinel = buildRepoContext(event);
        if (ctxOrSentinel === "unknown-team" || ctxOrSentinel === "no-team-id") {
          console.log(`Auto-react: ignoring Issue event (${ctxOrSentinel})`);
          return response;
        }
        const ctx = ctxOrSentinel;
        const cfgRaw = (() => {
          try { return readFileSync(ctx.configPath, "utf-8"); } catch { return undefined; }
        })();
        const config = getAutoReactConfig(cfgRaw);
        if (config.autoReact) {
          const classification = classifyIssueEvent(event);
          if (classification !== "skip") {
            console.log(`Auto-react[${ctx.teamId}]: ${classification} event, queuing heartbeat`);
            getDebouncer(ctx).queue(`${event.action}-${(event.data as Record<string, unknown>)?.id || "unknown"}`);
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
