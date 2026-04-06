import { describe, it, expect } from "vitest";
import { parseDotEnv } from "../env.js";

describe("parseDotEnv", () => {
  it("parses KEY=VALUE lines", () => {
    const content = `
LINEAR_CLIENT_ID=abc123
LINEAR_CLIENT_SECRET=secret456
`;
    const result = parseDotEnv(content);

    expect(result).toEqual({
      LINEAR_CLIENT_ID: "abc123",
      LINEAR_CLIENT_SECRET: "secret456",
    });
  });

  it("ignores comments and blank lines", () => {
    const content = `
# This is a comment
LINEAR_CLIENT_ID=abc123

  # Another comment
LINEAR_CLIENT_SECRET=secret456
`;
    const result = parseDotEnv(content);

    expect(result).toEqual({
      LINEAR_CLIENT_ID: "abc123",
      LINEAR_CLIENT_SECRET: "secret456",
    });
  });

  it("handles quoted values and strips quotes", () => {
    const content = `
LINEAR_CLIENT_ID="abc123"
LINEAR_CLIENT_SECRET='secret456'
`;
    const result = parseDotEnv(content);

    expect(result).toEqual({
      LINEAR_CLIENT_ID: "abc123",
      LINEAR_CLIENT_SECRET: "secret456",
    });
  });

  it("does not override existing env vars", () => {
    const content = `KEY=from_file`;
    const result = parseDotEnv(content);
    expect(result).toEqual({ KEY: "from_file" });
  });

  it("handles values with = signs", () => {
    const content = `DATABASE_URL=postgres://user:pass@host/db?ssl=true`;
    const result = parseDotEnv(content);
    expect(result).toEqual({
      DATABASE_URL: "postgres://user:pass@host/db?ssl=true",
    });
  });
});
