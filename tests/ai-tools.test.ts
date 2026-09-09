import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { executeTool, registerTool, resetTools, toolDefinitions } from "@/lib/ai/tools/registry";
import { ToolError, type ToolContext } from "@/lib/ai/tools/types";

// The registry writes its ledger through the service client; the boundary is
// stubbed so authorization logic can be tested without a database.
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({ insert: async () => ({ error: null }) }),
  }),
}));

const READ_ONLY: ReadonlySet<"read" | "write"> = new Set(["read"]);
const READ_WRITE: ReadonlySet<"read" | "write"> = new Set(["read", "write"]);

function context(allowedModes: ReadonlySet<"read" | "write">): ToolContext {
  return {
    projectId: "00000000-0000-4000-8000-000000000001",
    organizationId: "00000000-0000-4000-8000-000000000002",
    generationRunId: "run-1",
    allowedModes,
  };
}

beforeEach(() => {
  resetTools();

  registerTool({
    name: "echo",
    description: "Echoes its input.",
    mode: "read",
    schema: z.object({ value: z.string().min(1), times: z.number().int().default(1) }),
    jsonSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    async execute(_context, input) {
      return { echoed: input.value.repeat(input.times) };
    },
    summarise: (input) => `echoed ${input.value}`,
  });

  registerTool({
    name: "mutate",
    description: "Writes something.",
    mode: "write",
    schema: z.object({ path: z.string() }),
    jsonSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    async execute() {
      return { written: true };
    },
  });

  registerTool({
    name: "explode",
    description: "Always fails.",
    mode: "read",
    schema: z.object({}),
    jsonSchema: { type: "object", properties: {} },
    async execute() {
      throw new Error("upstream unavailable");
    },
  });
});

describe("tool authorization", () => {
  it("runs a read tool for a read-only agent", async () => {
    const result = await executeTool(context(READ_ONLY), "echo", { value: "hi" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toEqual({ echoed: "hi" });
  });

  // The context is the ceiling, not the tool list: a planner that somehow names
  // a write tool is still refused.
  it("refuses a write tool for a read-only agent", async () => {
    const result = await executeTool(context(READ_ONLY), "mutate", { path: "a.tsx" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_permitted");
      expect(result.error).toContain("write access");
    }
  });

  it("allows a write tool when the step permits writes", async () => {
    const result = await executeTool(context(READ_WRITE), "mutate", { path: "a.tsx" });
    expect(result.ok).toBe(true);
  });

  it("refuses a tool that does not exist", async () => {
    const result = await executeTool(context(READ_WRITE), "rm_rf", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unknown_tool");
  });
});

describe("argument validation", () => {
  it("rejects arguments that fail the schema", async () => {
    const result = await executeTool(context(READ_ONLY), "echo", { value: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_arguments");
      expect(result.error).toContain("value");
    }
  });

  it("applies schema defaults", async () => {
    const result = await executeTool(context(READ_ONLY), "echo", { value: "ab", times: 2 });
    if (result.ok) expect(result.output).toEqual({ echoed: "abab" });
  });

  it("rejects entirely malformed input", async () => {
    const result = await executeTool(context(READ_ONLY), "echo", "not an object");
    expect(result.ok).toBe(false);
  });
});

describe("failure handling", () => {
  // A model calling a tool wrongly is an ordinary event the agent loop should
  // recover from, not an exception that aborts a whole generation.
  it("returns errors rather than throwing", async () => {
    const result = await executeTool(context(READ_ONLY), "explode", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("execution_failed");
      expect(result.error).toContain("upstream unavailable");
    }
  });

  it("times every call, including failures", async () => {
    const failure = await executeTool(context(READ_ONLY), "explode", {});
    expect(failure.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("tool advertisement", () => {
  it("only advertises tools the agent may actually call", () => {
    const readOnly = toolDefinitions(READ_ONLY).map((tool) => tool.name);
    expect(readOnly).toContain("echo");
    expect(readOnly).not.toContain("mutate");

    expect(toolDefinitions(READ_WRITE).map((tool) => tool.name)).toContain("mutate");
  });

  it("advertises a JSON schema for each tool", () => {
    expect(toolDefinitions(READ_ONLY)[0]).toHaveProperty("input_schema");
  });
});

describe("ToolError", () => {
  it("carries a machine-readable code", () => {
    const error = new ToolError("not_permitted", "nope");
    expect(error.code).toBe("not_permitted");
    expect(error.name).toBe("ToolError");
  });
});
