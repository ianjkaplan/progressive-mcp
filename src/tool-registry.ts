import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type {
  ZodRawShapeCompat,
  AnySchema,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";

export type ToolVisibility = "always" | "on-demand";

// Mirrors the generic signature of McpServer.registerTool. We can't use
// Parameters<McpServer["registerTool"]> because TypeScript collapses the
// unresolved generics to their constraints, producing `never` for callback args.
type RegisterToolConfig<
  OutputArgs extends ZodRawShapeCompat | AnySchema = ZodRawShapeCompat | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
> = {
  title?: string;
  description?: string;
  inputSchema?: InputArgs;
  outputSchema?: OutputArgs;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
  visibility: ToolVisibility;
};

type RegisterToolFn = <
  OutputArgs extends ZodRawShapeCompat | AnySchema = ZodRawShapeCompat | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
>(
  name: string,
  config: RegisterToolConfig<OutputArgs, InputArgs>,
  cb: ToolCallback<InputArgs>,
) => RegisteredTool;

declare module "fastify" {
  interface FastifyInstance {
    mcp: {
      registerTool: RegisterToolFn;
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
  const server = opts.server;

  fastify.decorate("mcp", {
    registerTool(name, config, cb) {
      const { visibility, ...sdkConfig } = config;
      const registered = server.registerTool(name, sdkConfig, cb);
      if (visibility === "on-demand") {
        registered.disable();
      }
      return registered;
    },
  });
}

export default fp(toolRegistryPlugin, {
  fastify: "5.x",
  name: "unify-mcp-tool-registry",
});
