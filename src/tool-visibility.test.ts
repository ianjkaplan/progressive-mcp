import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import unifyMcpPlugin from "./index.js";
import { jsonrpc } from "./jsonrpc.js";

const MCP_PATH = "/mcp";

describe("tool visibility", () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    fastify = Fastify();
    await fastify.register(unifyMcpPlugin, {
      path: MCP_PATH,
      name: "test-server",
      version: "1.0.0",
    });
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

  function toolNames(body: { result: { tools: { name: string }[] } }) {
    return body.result.tools.map((t: { name: string }) => t.name);
  }

  it("always-visible tools appear in tools/list", async () => {
    fastify.mcp.registerTool(
      "visible-tool",
      {
        visibility: "always",
        description: "An always-visible tool",
        inputSchema: { input: z.string() },
      },
      ({ input }) => ({
        content: [{ type: "text" as const, text: input }],
      }),
    );
    await fastify.ready();

    const { body } = await mcpRequest(1, "tools/list", {});
    expect(toolNames(body)).toContain("visible-tool");
  });

  it("on-demand tools do not appear in tools/list", async () => {
    fastify.mcp.registerTool(
      "hidden-tool",
      {
        visibility: "on-demand",
        description: "An on-demand tool",
        inputSchema: { input: z.string() },
      },
      ({ input }) => ({
        content: [{ type: "text" as const, text: input }],
      }),
    );
    await fastify.ready();

    const { body } = await mcpRequest(1, "tools/list", {});
    expect(toolNames(body)).not.toContain("hidden-tool");
  });

  it("tools/list only returns always-visible tools when both tiers exist", async () => {
    fastify.mcp.registerTool(
      "always-a",
      {
        visibility: "always",
        description: "Always A",
        inputSchema: { x: z.string() },
      },
      ({ x }) => ({
        content: [{ type: "text" as const, text: x }],
      }),
    );

    fastify.mcp.registerTool(
      "always-b",
      {
        visibility: "always",
        description: "Always B",
      },
      () => ({
        content: [{ type: "text" as const, text: "b" }],
      }),
    );

    fastify.mcp.registerTool(
      "on-demand-c",
      {
        visibility: "on-demand",
        description: "On-demand C",
        inputSchema: { y: z.number() },
      },
      ({ y }) => ({
        content: [{ type: "text" as const, text: String(y) }],
      }),
    );

    fastify.mcp.registerTool(
      "on-demand-d",
      {
        visibility: "on-demand",
        description: "On-demand D",
      },
      () => ({
        content: [{ type: "text" as const, text: "d" }],
      }),
    );

    await fastify.ready();

    const { body } = await mcpRequest(1, "tools/list", {});
    const names = toolNames(body);

    expect(names).toContain("always-a");
    expect(names).toContain("always-b");
    expect(names).not.toContain("on-demand-c");
    expect(names).not.toContain("on-demand-d");
    // 2 user-registered always-visible tools + search_tools + call_tool
    expect(names).toHaveLength(4);
  });

});
