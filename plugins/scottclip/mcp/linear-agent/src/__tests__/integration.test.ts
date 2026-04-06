import { describe, it, expect, afterAll } from "vitest";

const PORT = 13847; // Use non-standard port to avoid conflicts

describe("consolidated server integration", () => {
  let serverProcess: ReturnType<typeof import("node:child_process").spawn> | null = null;

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      // Wait briefly for cleanup
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });

  it("starts and responds to GET /", async () => {
    const { spawn } = await import("node:child_process");

    serverProcess = spawn("node", ["dist/server.js"], {
      env: {
        ...process.env,
        WEBHOOK_PORT: String(PORT),
        // Provide minimal env so auth module doesn't crash
        LINEAR_CLIENT_ID: "test-client-id",
        LINEAR_CLIENT_SECRET: "test-client-secret",
        LINEAR_CALLBACK_HOST: "http://localhost",
      },
      stdio: "pipe",
    });

    // Wait for server to start
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Server startup timeout")), 5000);
      serverProcess!.stdout?.on("data", (data: Buffer) => {
        if (data.toString().includes("listening")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      serverProcess!.stderr?.on("data", (data: Buffer) => {
        // Log stderr for debugging
        process.stderr.write(data);
      });
      serverProcess!.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      serverProcess!.on("exit", (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timeout);
          reject(new Error(`Server exited with code ${code}`));
        }
      });
    });

    // Test GET /
    const statusRes = await fetch(`http://localhost:${PORT}/`);
    expect(statusRes.status).toBe(200);
    const html = await statusRes.text();
    expect(html).toContain("ScottClip Linear Agent");

    // Test POST /webhook with no signature returns 401
    const webhookRes = await fetch(`http://localhost:${PORT}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "test" }),
    });
    expect(webhookRes.status).toBe(401);
  });
});
