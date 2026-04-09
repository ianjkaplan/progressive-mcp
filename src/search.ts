import type { OnDemandToolEntry } from "./tool-registry.js";

export interface SearchResult {
  name: string;
  description?: string;
}

function parameterNames(entry: OnDemandToolEntry): string {
  const schema = entry.inputSchema;
  if (!schema || typeof schema !== "object") return "";
  if ("type" in schema) return ""; // AnySchema, not a raw shape
  return Object.keys(schema as Record<string, unknown>).join(" ");
}

/**
 * Exact keyword search — every whitespace-delimited term must appear
 * somewhere in the tool name, description, or parameter names.
 */
export function keywordSearch(
  tools: Iterable<OnDemandToolEntry>,
  query: string,
): SearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results: SearchResult[] = [];

  for (const entry of tools) {
    const searchable =
      `${entry.name} ${entry.description ?? ""} ${parameterNames(entry)}`.toLowerCase();
    if (terms.every((term) => searchable.includes(term))) {
      results.push({ name: entry.name, description: entry.description });
    }
  }

  return results;
}

// TODO: implement fuzzy keyword search (e.g. Levenshtein / trigram matching)
//       so queries with typos or partial terms still return relevant tools.

// TODO: implement embedding-based search with reranking — encode tool
//       descriptions and queries into vectors, retrieve top-N candidates by
//       cosine similarity, then rerank with a cross-encoder for precision.
