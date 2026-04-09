import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isToolCallback } from "./guards.js";

// eslint-disable-next-line @typescript-eslint/require-await -- fastify plugins must be async
async function callToolPlugin(fastify: FastifyInstance) {
  fastify.mcp.registerTool(
    "call_tool",
    {
      visibility: "always",
      description:
        "Call an on-demand tool by name with the provided arguments. Use search_tools first to discover available tools and their required inputSchema.",
      inputSchema: {
        tool_name: z
          .string()
          .describe("The name of the on-demand tool to call"),
        arguments: z
          .string()
          .describe(
            "JSON-encoded arguments to pass to the tool, matching its inputSchema",
          ),
      },
    },
    ({ tool_name, arguments: rawArgs }) => {
      let args: Record<string, unknown> | undefined;
      try {
        args = rawArgs
          ? (JSON.parse(rawArgs) as Record<string, unknown>)
          : undefined;
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Invalid JSON in arguments: ${rawArgs}`,
            },
          ],
        };
      }

      const entry = fastify.mcp.onDemandTools.get(tool_name);
      if (!entry) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Tool "${tool_name}" not found. Use search_tools to discover available tools.`,
            },
          ],
        };
      }

      const { registered } = entry;

      const handler = registered.handler;
      if (!isToolCallback(handler)) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Tool "${tool_name}" uses a task handler which is not supported by call_tool.`,
            },
          ],
        };
      }

      // Temporarily enable the tool so the handler can execute,
      // then disable it again to keep it out of tools/list.
      registered.enable();
      try {
        if (entry.inputSchema) {
          return handler(args ?? {}, {});
        }
        return handler({});
      } finally {
        registered.disable();
      }
    },
  );
}

export default fp(callToolPlugin, {
  fastify: "5.x",
  name: "progressive-mcp-call-tool",
  dependencies: ["progressive-mcp-search-tools"],
});
