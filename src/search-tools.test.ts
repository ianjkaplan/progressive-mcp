import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import progressiveMcpPlugin from "./index.js";
import { jsonrpc } from "./jsonrpc.js";

const MCP_PATH = "/mcp";

describe("search_tools", () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    fastify = Fastify();
    await fastify.register(progressiveMcpPlugin, {
      path: MCP_PATH,
      name: "test-server",
      version: "1.0.0",
    });

    fastify.mcp.registerTool(
      "send-email",
      {
        visibility: "on-demand",
        description: "Send an email to a recipient",
        inputSchema: { to: z.string(), body: z.string() },
      },
      ({ to, body }) => ({
        content: [{ type: "text" as const, text: `Sent to ${to}: ${body}` }],
      }),
    );

    fastify.mcp.registerTool(
      "create-calendar-event",
      {
        visibility: "on-demand",
        description: "Create a new calendar event",
        inputSchema: { title: z.string(), date: z.string() },
      },
      ({ title, date }) => ({
        content: [
          { type: "text" as const, text: `Event: ${title} on ${date}` },
        ],
      }),
    );

    fastify.mcp.registerTool(
      "always-visible-tool",
      {
        visibility: "always",
        description: "An always-visible tool",
      },
      () => ({
        content: [{ type: "text" as const, text: "visible" }],
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

  function parseSearchResult(body: {
    result: { content: { text: string }[] };
  }) {
    return JSON.parse(body.result.content[0].text);
  }

  it("search_tools is always-visible in tools/list", async () => {
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
    expect(names).toContain("search_tools");
  });

  it("returns matching on-demand tools by keyword", async () => {
    const body = await callTool("search_tools", { query: "email" });
    const result = parseSearchResult(body);

    expect(result).toMatchSnapshot();
  });

  it("matches tool by partial name", async () => {
    const body = await callTool("search_tools", { query: "create" });
    const result = parseSearchResult(body);

    expect(result).toMatchSnapshot();
  });

  it("returns empty results when no tools match", async () => {
    const body = await callTool("search_tools", { query: "nonexistent" });
    const result = parseSearchResult(body);

    expect(result).toMatchSnapshot();
  });

  it("does not return always-visible tools", async () => {
    const body = await callTool("search_tools", { query: "visible" });
    const result = parseSearchResult(body);

    expect(result).toMatchSnapshot();
  });

  it("matches on multiple terms (AND logic)", async () => {
    const body = await callTool("search_tools", { query: "calendar event" });
    const result = parseSearchResult(body);

    expect(result).toMatchSnapshot();
  });
});
