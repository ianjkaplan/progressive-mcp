import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

declare module "fastify" {
  interface FastifyInstance {
    mcp: {
      registerTool: McpServer["registerTool"];
    };
  }
}

export interface ToolRegistryOptions {
  server: McpServer;
}

async function toolRegistryPlugin(
  fastify: FastifyInstance,
  opts: ToolRegistryOptions,
) {
  fastify.decorate("mcp", {
    registerTool: opts.server.registerTool.bind(opts.server),
  });
}

export default fp(toolRegistryPlugin, {
  fastify: "5.x",
  name: "unify-mcp-tool-registry",
});
