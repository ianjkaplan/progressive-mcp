import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import toolRegistryPlugin from "./tool-registry.js";

describe("toolRegistryPlugin", () => {
  let fastify: FastifyInstance;
  let server: McpServer;
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fastify = Fastify();
    server = new McpServer({ name: "test", version: "0.0.0" });
    spy = vi.spyOn(server, "registerTool");
    await fastify.register(toolRegistryPlugin, { server });
  });

  afterEach(async () => {
    await fastify.close();
  });

  it("decorates fastify with mcp.registerTool", () => {
    expect(fastify.mcp).toBeDefined();
    expect(typeof fastify.mcp.registerTool).toBe("function");
  });

  it("delegates to server.registerTool", () => {
    const cb = () => ({ content: [{ type: "text" as const, text: "ok" }] });
    fastify.mcp.registerTool("my-tool", {}, cb);

    expect(spy).toHaveBeenCalledWith("my-tool", {}, cb);
  });

  it("registers a tool with description and input schema", () => {
    const config = {
      description: "A test tool",
      inputSchema: { input: z.string() },
    };
    const cb = () => ({ content: [{ type: "text" as const, text: "ok" }] });
    fastify.mcp.registerTool("my-tool", config, cb);

    expect(spy).toHaveBeenCalledWith("my-tool", config, cb);
  });
});
