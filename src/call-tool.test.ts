import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import unifyMcpPlugin from "./index.js";
import { jsonrpc } from "./jsonrpc.js";

const MCP_PATH = "/mcp";

describe("call_tool", () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    fastify = Fastify();
    await fastify.register(unifyMcpPlugin, {
      path: MCP_PATH,
      name: "test-server",
      version: "1.0.0",
    });

    fastify.mcp.registerTool(
      "add-numbers",
      {
        visibility: "on-demand",
        description: "Add two numbers together",
        inputSchema: { a: z.number(), b: z.number() },
      },
      ({ a, b }) => ({
        content: [
          { type: "text" as const, text: String(a + b) },
        ],
      }),
    );

    fastify.mcp.registerTool(
      "no-args-tool",
      {
        visibility: "on-demand",
        description: "A tool that takes no arguments",
      },
      () => ({
        content: [{ type: "text" as const, text: "no args needed" }],
      }),
    );

    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await fastify.inject({
      method: "POST",
      url: MCP_PATH,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      payload: jsonrpc(1, "tools/call", { name, arguments: args }),
    });
    return JSON.parse(res.body);
  }

  it("call_tool is always-visible in tools/list", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: MCP_PATH,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      payload: jsonrpc(1, "tools/list", {}),
    });
    const body = JSON.parse(res.body);
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("call_tool");
  });

  it("calls an on-demand tool with arguments", async () => {
    const body = await callTool("call_tool", {
      tool_name: "add-numbers",
      arguments: JSON.stringify({ a: 3, b: 4 }),
    });

    expect(body.result.content).toEqual([
      { type: "text", text: "7" },
    ]);
  });

  it("calls an on-demand tool with no arguments", async () => {
    const body = await callTool("call_tool", {
      tool_name: "no-args-tool",
      arguments: "{}",
    });

    expect(body.result.content).toEqual([
      { type: "text", text: "no args needed" },
    ]);
  });

  it("returns an error for an unknown tool name", async () => {
    const body = await callTool("call_tool", {
      tool_name: "nonexistent",
      arguments: "{}",
    });

    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("not found");
  });

  it("returns an error for invalid JSON in arguments", async () => {
    const body = await callTool("call_tool", {
      tool_name: "add-numbers",
      arguments: "not-valid-json",
    });

    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("Invalid JSON");
  });

  it("on-demand tool stays hidden after being called via call_tool", async () => {
    // Call the tool via proxy
    await callTool("call_tool", {
      tool_name: "add-numbers",
      arguments: JSON.stringify({ a: 1, b: 2 }),
    });

    // Verify it's still not in tools/list
    const res = await fastify.inject({
      method: "POST",
      url: MCP_PATH,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      payload: jsonrpc(2, "tools/list", {}),
    });
    const body = JSON.parse(res.body);
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain("add-numbers");
  });
});
