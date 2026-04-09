import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import toolRegistryPlugin from "./tool-registry.js";
import searchToolsPlugin from "./search-tools.js";
import callToolPlugin from "./call-tool.js";

export interface ProgressiveMcpPluginOptions {
  path: string;
  name: string;
  version: string;
}

async function progressiveMcpPlugin(
  fastify: FastifyInstance,
  opts: ProgressiveMcpPluginOptions,
) {
  const { path, name, version } = opts;
  const server = new McpServer({ name, version });

  await fastify.register(toolRegistryPlugin, { server });
  await fastify.register(searchToolsPlugin);
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
      transport.close();
    });
    reply.raw.on("close", () => {
      transport.close();
    });

    await server.connect(transport);

    await transport.handleRequest(request.raw, reply.raw, request.body);
    return reply.hijack();
  });
}

export default fp(progressiveMcpPlugin, {
  fastify: "5.x",
  name: "progressive-mcp",
});
