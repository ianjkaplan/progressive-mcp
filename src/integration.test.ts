import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import unifyMcpPlugin from "./index.js";
import { jsonrpc } from "./jsonrpc.js";

const MCP_PATH = "/mcp";

describe("unify-mcp integration", () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    fastify = Fastify();
    await fastify.register(unifyMcpPlugin, {
      path: MCP_PATH,
      name: "test-server",
      version: "1.0.0",
    });

    fastify.mcp.registerTool(
      "greet",
      {
        visibility: "always",
        description: "Greets someone by name",
        inputSchema: { name: z.string() },
      },
      ({ name }) => ({
        content: [{ type: "text" as const, text: `Hello, ${name}!` }],
      }),
    );

    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  async function mcpRequest(
    id: number,
    method: string,
    params: Record<string, unknown>,
  ) {
    const res = await fastify.inject({
      method: "POST",
      url: MCP_PATH,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      payload: jsonrpc(id, method, params),
    });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  }

  it("responds to initialize", async () => {
    const { status, body } = await mcpRequest(1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    expect(status).toBe(200);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(body.result.serverInfo.name).toBe("test-server");
    expect(body.result.protocolVersion).toBeDefined();
  });

  it("lists registered tools", async () => {
    const { status, body } = await mcpRequest(2, "tools/list", {});

    expect(status).toBe(200);
    expect(body.result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "greet",
          description: "Greets someone by name",
        }),
      ]),
    );
  });

  it("calls a tool and returns the result", async () => {
    const { status, body } = await mcpRequest(3, "tools/call", {
      name: "greet",
      arguments: { name: "World" },
    });

    expect(status).toBe(200);
    expect(body.result.content).toEqual([
      { type: "text", text: "Hello, World!" },
    ]);
  });

  it("returns an error for an unknown tool", async () => {
    const { status, body } = await mcpRequest(4, "tools/call", {
      name: "nonexistent",
      arguments: {},
    });

    expect(status).toBe(200);
    expect(body.result.isError).toBe(true);
  });
});
