import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import toolRegistryPlugin from "./tool-registry.js";
import searchToolsPlugin from "./search-tools.js";
import callToolPlugin from "./call-tool.js";
import type { SearchFunction } from "./search.js";

interface SharedOptions {
  /** Optional custom search function to replace the built-in RRF pipeline. */
  search?: SearchFunction;
}

/** Use an existing McpServer instance with the plugin. */
interface ProgressiveMcpServerOptions extends SharedOptions {
  /** Route path for the MCP endpoint (e.g. "/mcp"). */
  path: string;
  /** Pre-configured McpServer to use. */
  server: McpServer;
}

/** Let the plugin create an McpServer internally. */
interface ProgressiveMcpConfigOptions extends SharedOptions {
  /** Route path for the MCP endpoint (e.g. "/mcp"). */
  path: string;
  /** Server name surfaced in the MCP initialize response. */
  name: string;
  /** Server version surfaced in the MCP initialize response. */
  version: string;
}

/**
 * Plugin options — either supply your own McpServer or provide a name and
 * version and the plugin will create one for you.
 */
export type ProgressiveMcpPluginOptions =
  | ProgressiveMcpServerOptions
  | ProgressiveMcpConfigOptions;

async function progressiveMcpPlugin(
  fastify: FastifyInstance,
  opts: ProgressiveMcpPluginOptions,
) {
  const { path } = opts;
  const server =
    "server" in opts
      ? opts.server
      : new McpServer({ name: opts.name, version: opts.version });

  await fastify.register(toolRegistryPlugin, { server });
  await fastify.register(searchToolsPlugin, {
    search: opts.search,
  });
  await fastify.register(callToolPlugin);

  /**
   * minimal mcp endpoint for stateless requests
   * mainly suitable for tool calls
   *
   * for long lived connections proper session management is needed
   */
  fastify.post(path, async (request, reply) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    request.raw.on("close", () => {
      void transport.close();
    });
    reply.raw.on("close", () => {
      void transport.close();
    });

    await server.connect(transport);

    await transport.handleRequest(request.raw, reply.raw, request.body);
    return reply.hijack();
  });
}

export type { SearchFunction, SearchResult } from "./search.js";
export {
  searchTools,
  keywordSearch,
  keywordRank,
  fuzzyScore,
  bm25Rank,
  reciprocalRankFusion,
} from "./search.js";

export default fp(progressiveMcpPlugin, {
  fastify: "5.x",
  name: "progressive-mcp",
});
