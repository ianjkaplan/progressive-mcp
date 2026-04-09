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
app.mcp.registerTool(
  "get-user",
  {
    visibility: "always",
    description: "Get a user by ID",
    inputSchema: { id: z.string() },
  },
  ({ id }) => ({
    content: [{ type: "text", text: JSON.stringify({ id, name: "Alice" }) }],
  }),
);

// Hidden — discoverable only via search_tools
app.mcp.registerTool(
  "send-email",
  {
    visibility: "on-demand",
    description: "Send an email to a recipient",
    inputSchema: {
      to: z.string(),
      body: z.string(),
    },
  },
  ({ to, body }) => ({
    content: [{ type: "text", text: `Sent to ${to}` }],
  }),
);

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

| Visibility    | `tools/list` | Searchable | Callable via `call_tool` |
| ------------- | ------------ | ---------- | ------------------------ |
| `"always"`    | Yes          | Yes        | Yes                      |
| `"on-demand"` | No           | Yes        | Yes                      |

## Built-in Tools

The plugin automatically registers two meta-tools that are always visible:

### `search_tools`

Searches across all registered tools (both `always` and `on-demand`) using a multi-algorithm ranking system:

- **Keyword matching** — exact term hits in name, description, and parameters
- **BM25** — probabilistic TF-IDF relevance scoring
- **Fuzzy matching** — trigram similarity for typo tolerance

Results are combined via **[Reciprocal Rank Fusion (RRF)](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)** and filtered by relevance threshold.

```json
{
  "name": "search_tools",
  "arguments": { "query": "email", "limit": 10 }
}
```

#### Custom Search Function

You can replace the built-in search pipeline entirely by passing a `search` option. This is useful when you have your own embedding-based search, a vector database, or any other retrieval strategy:

```typescript
import progressiveMcpPlugin from "progressive-mcp";
import type { SearchFunction } from "progressive-mcp";

const mySearch: SearchFunction = async (tools, query, limit) => {
  // Look up pre-computed embeddings, query a vector DB, etc.
  const results = await myVectorDb.search(query, {
    candidates: tools.map((t) => t.name),
    limit,
  });
  return results.map((r) => ({
    name: r.name,
    description: r.description,
    score: r.similarity,
  }));
};

await app.register(progressiveMcpPlugin, {
  path: "/mcp",
  name: "my-server",
  version: "1.0.0",
  search: mySearch,
});
```

The `SearchFunction` signature is:

```typescript
type SearchFunction = (
  tools: OnDemandToolEntry[],
  query: string,
  limit?: number,
) => SearchResult[] | Promise<SearchResult[]>;
```

#### Exported Search Utilities

All built-in search functions are exported so you can compose your own pipeline:

```typescript
import {
  searchTools, // Default RRF pipeline (keyword + BM25 + fuzzy)
  keywordSearch, // Binary keyword matching (all terms must match)
  keywordRank, // Ranked keyword matching (by term hit count)
  bm25Rank, // Okapi BM25 ranking
  fuzzyScore, // Trigram similarity between two strings
  reciprocalRankFusion, // Fuse multiple ranked lists via RRF
} from "progressive-mcp";
```

For example, to add an embedding ranker on top of the built-in pipeline:

```typescript
import {
  searchTools,
  reciprocalRankFusion,
  keywordRank,
  bm25Rank,
} from "progressive-mcp";
import type { SearchFunction } from "progressive-mcp";

const mySearch: SearchFunction = async (tools, query, limit) => {
  // Run the built-in rankers
  const keyword = keywordRank(tools, query);
  const bm25 = bm25Rank(tools, query);

  // Add your own embedding-based ranker
  const embedding = await myEmbeddingRank(tools, query);

  // Fuse all lists with RRF
  const fused = reciprocalRankFusion([keyword, bm25, embedding]);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const results = fused.map((r) => ({
    ...r,
    description: byName.get(r.name)?.description,
  }));
  return limit != null ? results.slice(0, limit) : results;
};
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
