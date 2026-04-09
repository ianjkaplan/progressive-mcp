import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type ToolCallbackFn = (
  ...args: unknown[]
) => CallToolResult | Promise<CallToolResult>;

// Task handlers (ToolTaskHandler) are not supported — only plain
// ToolCallback handlers can be invoked through the call_tool proxy.
// A ToolTaskHandler is an object with a `createTask` method, whereas
// a ToolCallback is a callable function.
export function isToolCallback(
  handler: ((...args: never[]) => unknown) | { createTask: unknown },
): handler is ToolCallbackFn {
  return !("createTask" in handler);
}
