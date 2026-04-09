import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import toolRegistryPlugin from "./tool-registry.js";

export interface UnifyMcpPluginOptions {
  path: string;
  name: string;
  version: string;
}

async function unifyMcpPlugin(
  fastify: FastifyInstance,
  opts: UnifyMcpPluginOptions,
) {
  const { path, name, version } = opts;
  const server = new McpServer({ name, version });

  await fastify.register(toolRegistryPlugin, { server });

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

export default fp(unifyMcpPlugin, {
  fastify: "5.x",
  name: "unify-mcp",
});
