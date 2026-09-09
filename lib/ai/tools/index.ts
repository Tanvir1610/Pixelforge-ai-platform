import "server-only";

// Importing a tool module registers its tools. Kept in one place so an agent
// never has to know which file a tool lives in.
import "./design-tools";
import "./file-tools";

export { executeTool, getTool, toolDefinitions, registerTool, resetTools } from "./registry";
export { stagedWrites, clearStagedWrites } from "./file-tools";
export type { Tool, ToolContext, ToolMode, ToolResult } from "./types";
export { ToolError } from "./types";

/** Read-only agents (planners) get this set. */
export const READ_ONLY: ReadonlySet<"read" | "write"> = new Set(["read"]);
/** Code-writing agents get this one. */
export const READ_WRITE: ReadonlySet<"read" | "write"> = new Set(["read", "write"]);
