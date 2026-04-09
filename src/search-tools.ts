import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import type { OnDemandToolEntry } from "./tool-registry.js";

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

function matchesQuery(entry: OnDemandToolEntry, query: string): boolean {
  const lowerQuery = query.toLowerCase();
  const terms = lowerQuery.split(/\s+/).filter(Boolean);
  const haystack = `${entry.name} ${entry.description ?? ""}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

async function searchToolsPlugin(fastify: FastifyInstance) {
  fastify.mcp.registerTool(
    "search_tools",
    {
      visibility: "always",
      description:
        "Search for available on-demand tools by natural language query. Returns matching tool definitions including their full inputSchema so you can call them via call_tool.",
      inputSchema: { query: z.string().describe("Natural language search query describing the tool you need") },
    },
    ({ query }) => {
      const results: Array<{
        name: string;
        description?: string;
        inputSchema: unknown;
      }> = [];

      for (const entry of fastify.mcp.onDemandTools.values()) {
        if (matchesQuery(entry, query)) {
          results.push({
            name: entry.name,
            description: entry.description,
            inputSchema: toJsonSchema(entry),
          });
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                matches: results.length,
                tools: results,
              },
              null,
              2,
            ),
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
