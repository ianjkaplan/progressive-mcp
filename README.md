# progressive-mcp

A Fastify plugin that implements [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) over Streamable HTTP, with **progressive tool discovery** — tools can be hidden from `tools/list` and revealed only through search.

## Why?

Standard MCP servers expose every tool in `tools/list`. When you have dozens or hundreds of tools, this overwhelms clients and wastes context. Progressive MCP lets you mark tools as **on-demand**, keeping them hidden until a client searches for them.

## Install

```bash
npm install progressive-mcp
```

Peer dependencies: `fastify`, `@modelcontextprotocol/sdk`, `zod`

## Quick Start

```typescript
import Fastify from "fastify";
import progressiveMcpPlugin from "progressive-mcp";
import { z } from "zod";

const app = Fastify();

await app.register(progressiveMcpPlugin, {
  path: "/mcp",
  name: "my-server",
  version: "1.0.0",
});

// Always visible in tools/list
app.mcp.registerTool("get-status", {
  visibility: "always",
  description: "Get system status",
  inputSchema: {},
}, () => ({
  content: [{ type: "text", text: "OK" }],
}));

// Hidden — discoverable only via search_tools
app.mcp.registerTool("send-email", {
  visibility: "on-demand",
  description: "Send an email to a recipient",
  inputSchema: {
    to: z.string(),
    body: z.string(),
  },
}, ({ to, body }) => ({
  content: [{ type: "text", text: `Sent to ${to}` }],
}));

await app.listen({ port: 3000 });
```

## Plugin Options

You can either let the plugin create an `McpServer` or provide your own:

```typescript
// Option A: plugin creates the server
await app.register(progressiveMcpPlugin, {
  path: "/mcp",
  name: "my-server",
  version: "1.0.0",
});

// Option B: bring your own McpServer
await app.register(progressiveMcpPlugin, {
  path: "/mcp",
  server: existingMcpServer,
});
```

## Tool Visibility

Each tool registered through `app.mcp.registerTool` must specify a `visibility`:

| Visibility | `tools/list` | Searchable | Callable via `call_tool` |
|------------|-------------|------------|--------------------------|
| `"always"` | Yes | Yes | Yes |
| `"on-demand"` | No | Yes | Yes |

## Built-in Tools

The plugin automatically registers two meta-tools that are always visible:

### `search_tools`

Searches across all registered tools (both `always` and `on-demand`) using a multi-algorithm ranking system:

- **Keyword matching** — exact term hits in name, description, and parameters
- **BM25** — probabilistic TF-IDF relevance scoring
- **Fuzzy matching** — trigram similarity for typo tolerance

Results are combined via **Reciprocal Rank Fusion (RRF)** and filtered by relevance threshold.

```json
{
  "name": "search_tools",
  "arguments": { "query": "email", "limit": 10 }
}
```

### `call_tool`

Executes any tool (including on-demand tools) by name, without exposing it in `tools/list`:

```json
{
  "name": "call_tool",
  "arguments": {
    "tool_name": "send-email",
    "arguments": "{\"to\": \"user@example.com\", \"body\": \"Hello\"}"
  }
}
```

## Development

```bash
npm run build       # Build with Vite
npm run dev         # Build in watch mode
npm test            # Run tests with Vitest
npm run typecheck   # Type-check with tsc
```

## License

ISC
