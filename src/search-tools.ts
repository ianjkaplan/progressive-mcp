import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import type { OnDemandToolEntry } from "./tool-registry.js";
import { searchTools as defaultSearch } from "./search.js";
import type { SearchFunction } from "./search.js";

const EMPTY_OBJECT_JSON_SCHEMA = {
  type: "object" as const,
  properties: {},
};

function toJsonSchema(entry: OnDemandToolEntry) {
  if (!entry.inputSchema) return EMPTY_OBJECT_JSON_SCHEMA;
  const obj = normalizeObjectSchema(entry.inputSchema);
  return obj
    ? toJsonSchemaCompat(obj, { strictUnions: true, pipeStrategy: "input" })
    : EMPTY_OBJECT_JSON_SCHEMA;
}

export interface SearchToolsPluginOptions {
  search?: SearchFunction;
}

// eslint-disable-next-line @typescript-eslint/require-await -- fastify plugins must be async
async function searchToolsPlugin(
  fastify: FastifyInstance,
  opts: SearchToolsPluginOptions,
) {
  const search: SearchFunction = opts.search ?? defaultSearch;
  fastify.mcp.registerTool(
    "search_tools",
    {
      visibility: "always",
      description:
        "Search for available on-demand tools by natural language query. Returns matching tool definitions including their full inputSchema so you can call them via call_tool.",
      inputSchema: {
        query: z
          .string()
          .describe(
            "Natural language search query describing the tool you need",
          ),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of results to return"),
      },
    },
    async ({ query, limit }) => {
      const matches = await search(
        [...fastify.mcp.onDemandTools.values()],
        query,
        limit,
      );

      const tools = matches
        .map((m) => {
          const entry = fastify.mcp.onDemandTools.get(m.name);
          if (!entry) return null;
          return {
            name: m.name,
            description: m.description,
            inputSchema: toJsonSchema(entry),
          };
        })
        .filter((t) => t !== null);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              matches: tools.length,
              tools,
            }),
          },
        ],
      };
    },
  );
}

export default fp(searchToolsPlugin, {
  fastify: "5.x",
  name: "progressive-mcp-search-tools",
  dependencies: ["progressive-mcp-tool-registry"],
});
