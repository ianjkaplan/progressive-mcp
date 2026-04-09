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

interface ToolSchemaFields<
  OutputArgs extends ZodRawShapeCompat | AnySchema =
    | ZodRawShapeCompat
    | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
> {
  description?: string;
  inputSchema?: InputArgs;
  outputSchema?: OutputArgs;
}

export interface OnDemandToolEntry extends ToolSchemaFields<
  ZodRawShapeCompat | AnySchema,
  ZodRawShapeCompat | AnySchema | undefined
> {
  name: string;
  registered: RegisteredTool;
}

// Mirrors the generic signature of McpServer.registerTool. We can't use
// Parameters<McpServer["registerTool"]> because TypeScript collapses the
// unresolved generics to their constraints, producing `never` for callback args.
type RegisterToolConfig<
  OutputArgs extends ZodRawShapeCompat | AnySchema =
    | ZodRawShapeCompat
    | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
> = ToolSchemaFields<OutputArgs, InputArgs> & {
  title?: string;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
  visibility: ToolVisibility;
};

type RegisterToolFn = <
  OutputArgs extends ZodRawShapeCompat | AnySchema =
    | ZodRawShapeCompat
    | AnySchema,
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
      onDemandTools: ReadonlyMap<string, OnDemandToolEntry>;
    };
  }
}

export interface ToolRegistryOptions {
  server: McpServer;
}

// eslint-disable-next-line @typescript-eslint/require-await -- fastify plugins must be async
async function toolRegistryPlugin(
  fastify: FastifyInstance,
  opts: ToolRegistryOptions,
) {
  const server = opts.server;
  const onDemandTools = new Map<string, OnDemandToolEntry>();

  fastify.decorate("mcp", {
    registerTool(name, config, cb) {
      const { visibility, ...sdkConfig } = config;
      const registered = server.registerTool(name, sdkConfig, cb);
      if (visibility === "on-demand") {
        registered.disable();
        onDemandTools.set(name, {
          name,
          description: config.description,
          inputSchema: config.inputSchema,
          outputSchema: config.outputSchema,
          registered,
        });
      }
      return registered;
    },
    onDemandTools: onDemandTools as ReadonlyMap<string, OnDemandToolEntry>,
  });
}

export default fp(toolRegistryPlugin, {
  fastify: "5.x",
  name: "progressive-mcp-tool-registry",
});
