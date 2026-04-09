import type { OnDemandToolEntry } from "./tool-registry.js";

export interface SearchResult {
  name: string;
  description?: string;
  score: number;
}

function parameterNames(entry: OnDemandToolEntry): string {
  const schema = entry.inputSchema;
  if (!schema || typeof schema !== "object") return "";
  if ("type" in schema) return ""; // AnySchema, not a raw shape
  return Object.keys(schema as Record<string, unknown>).join(" ");
}

/** Build the searchable text blob for a tool entry. */
function searchableText(entry: OnDemandToolEntry): string {
  return `${entry.name} ${entry.description ?? ""} ${parameterNames(entry)}`.toLowerCase();
}

// ---------------------------------------------------------------------------
// Keyword search (original, preserved for backwards compat)
// ---------------------------------------------------------------------------

/**
 * Exact keyword search — every whitespace-delimited term must appear
 * somewhere in the tool name, description, or parameter names.
 */
export function keywordSearch(
  tools: Iterable<OnDemandToolEntry>,
  query: string,
): Omit<SearchResult, "score">[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results: Omit<SearchResult, "score">[] = [];

  for (const entry of tools) {
    const searchable = searchableText(entry);
    if (terms.every((term) => searchable.includes(term))) {
      results.push({ name: entry.name, description: entry.description });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Keyword rank — ranked variant of keyword search
// ---------------------------------------------------------------------------

/**
 * Rank tools by the number of query terms that appear in their searchable
 * text. Tools with zero matching terms are excluded.
 */
export function keywordRank(
  tools: Iterable<OnDemandToolEntry>,
  query: string,
): string[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...tools].map((t) => t.name);

  const scored: { name: string; hits: number }[] = [];

  for (const entry of tools) {
    const searchable = searchableText(entry);
    // Count how many query terms appear in this tool's text.
    const hits = terms.filter((t) => searchable.includes(t)).length;
    if (hits > 0) scored.push({ name: entry.name, hits });
  }

  // Sort descending by hit count, then alphabetically for stability.
  scored.sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name));
  return scored.map((s) => s.name);
}

// ---------------------------------------------------------------------------
// Fuzzy score — trigram similarity
// ---------------------------------------------------------------------------

/**
 * Compute trigram similarity between two strings, returned as a value in
 * [0, 1]. Trigrams are overlapping 3-character slices of each string.
 *
 * Similarity = |intersection(trigramsA, trigramsB)| / |union(trigramsA, trigramsB)|
 *
 * This is the Jaccard index over trigram multisets, which is a standard
 * approximation for fuzzy string matching (used by PostgreSQL pg_trgm).
 */
export function fuzzyScore(a: string, b: string): number {
  if (a === "" && b === "") return 1;
  if (a === "" || b === "") return 0;

  const trigramsOf = (s: string): string[] => {
    s = s.toLowerCase();
    // Pad with spaces so edge characters still produce trigrams.
    const padded = `  ${s} `;
    const tris: string[] = [];
    for (let i = 0; i <= padded.length - 3; i++) {
      tris.push(padded.slice(i, i + 3));
    }
    return tris;
  };

  const tA = trigramsOf(a);
  const tB = trigramsOf(b);

  // Build a frequency map for B's trigrams.
  const freqB = new Map<string, number>();
  for (const t of tB) freqB.set(t, (freqB.get(t) ?? 0) + 1);

  // Count intersection size (min of frequencies for each shared trigram).
  let intersection = 0;
  const usedB = new Map<string, number>();
  for (const t of tA) {
    const remaining = (freqB.get(t) ?? 0) - (usedB.get(t) ?? 0);
    if (remaining > 0) {
      intersection++;
      usedB.set(t, (usedB.get(t) ?? 0) + 1);
    }
  }

  // |union| = |A| + |B| - |intersection|  (inclusion-exclusion on multisets)
  const union = tA.length + tB.length - intersection;
  return union === 0 ? 1 : intersection / union;
}

// ---------------------------------------------------------------------------
// BM25 rank
// ---------------------------------------------------------------------------

/**
 * Rank tools using Okapi BM25, a probabilistic relevance function.
 *
 * For each query term t in document d:
 *
 *   BM25(d, q) = Σ IDF(t) · [ tf(t,d) · (k1 + 1) ] / [ tf(t,d) + k1 · (1 - b + b · |d|/avgdl) ]
 *
 * Where:
 *   tf(t,d)  = frequency of term t in document d
 *   IDF(t)   = ln( (N - df(t) + 0.5) / (df(t) + 0.5) + 1 )
 *              N = total documents, df(t) = documents containing t
 *   k1       = term frequency saturation parameter (1.2 is standard)
 *   b        = length normalisation parameter (0.75 is standard)
 *   |d|      = length of document d in words
 *   avgdl    = average document length across the corpus
 */
export function bm25Rank(
  tools: Iterable<OnDemandToolEntry>,
  query: string,
): string[] {
  const k1 = 1.2;
  const b = 0.75;

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...tools].map((t) => t.name);

  // Tokenise each tool's searchable text into words.
  const docs: { name: string; words: string[] }[] = [];
  for (const entry of tools) {
    const words = searchableText(entry).split(/\s+/).filter(Boolean);
    docs.push({ name: entry.name, words });
  }

  const N = docs.length;
  if (N === 0) return [];

  // avgdl = average document length (in words) across all tools.
  const avgdl = docs.reduce((sum, d) => sum + d.words.length, 0) / N;

  // df(t) = number of documents containing term t.
  const df = new Map<string, number>();
  for (const term of terms) {
    let count = 0;
    for (const doc of docs) {
      if (doc.words.some((w) => w.includes(term))) count++;
    }
    df.set(term, count);
  }

  const scored: { name: string; score: number }[] = [];

  for (const doc of docs) {
    let score = 0;
    const docLen = doc.words.length;

    for (const term of terms) {
      // tf = how many words in this document contain the term.
      const tf = doc.words.filter((w) => w.includes(term)).length;
      if (tf === 0) continue;

      const termDf = df.get(term) ?? 0;

      // IDF: ln( (N - df + 0.5) / (df + 0.5) + 1 )
      // The +1 outside ensures IDF is always positive, even for terms
      // appearing in every document.
      const idf = Math.log((N - termDf + 0.5) / (termDf + 0.5) + 1);

      // BM25 numerator: tf · (k1 + 1)
      const num = tf * (k1 + 1);

      // BM25 denominator: tf + k1 · (1 - b + b · docLen / avgdl)
      // The (1 - b + b · docLen/avgdl) factor normalises for document length:
      // longer docs are penalised so short, focused descriptions score higher.
      const denom = tf + k1 * (1 - b + (b * docLen) / avgdl);

      score += idf * (num / denom);
    }

    if (score > 0) scored.push({ name: doc.name, score });
  }

  // Sort descending by score, then alphabetically for stability.
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.map((s) => s.name);
}

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion
// ---------------------------------------------------------------------------

/**
 * Combine multiple ranked lists into a single ranking using Reciprocal Rank
 * Fusion (Cormack, Clarke & Buettcher, 2009).
 *
 * For each item across all lists, the fused score is:
 *
 *   RRF_score(item) = Σ  1 / (k + rank_i + 1)
 *
 * where rank_i is the 0-based position in ranked list i, and k is a
 * smoothing constant (default 60). The +1 converts to 1-based ranking.
 * A higher k dampens the influence of rank position, making all ranks
 * contribute more equally; the standard value of 60 works well empirically.
 *
 * Items appearing in more lists and at higher ranks get higher scores.
 */
export function reciprocalRankFusion(
  rankedLists: string[][],
  k: number = 60,
): SearchResult[] {
  const scores = new Map<string, number>();

  for (const ranked of rankedLists) {
    for (let rank = 0; rank < ranked.length; rank++) {
      const name = ranked[rank];
      // RRF contribution from this list: 1 / (k + 1-based-rank)
      // Since rank is 0-based, 1-based rank = rank + 1.
      scores.set(name, (scores.get(name) ?? 0) + 1 / (k + rank + 1));
    }
  }

  const results: SearchResult[] = [...scores.entries()].map(([name, score]) => ({
    name,
    score,
  }));

  // Sort descending by fused score.
  results.sort((a, b) => b.score - a.score);
  return results;
}

// ---------------------------------------------------------------------------
// Fuzzy rank — rank tools by best trigram similarity to query
// ---------------------------------------------------------------------------

function fuzzyRank(
  tools: OnDemandToolEntry[],
  query: string,
): string[] {
  const q = query.toLowerCase();

  const scored: { name: string; score: number }[] = [];
  for (const entry of tools) {
    // Score against name and each word in description; take the best match.
    const candidates = [entry.name, ...(entry.description ?? "").split(/\s+/)];
    let best = 0;
    for (const c of candidates) {
      const s = fuzzyScore(q, c);
      if (s > best) best = s;
    }
    // Only include if there's meaningful similarity. A threshold of 0.2
    // filters out noise from short trigram overlaps on unrelated strings.
    if (best > 0.2) scored.push({ name: entry.name, score: best });
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.map((s) => s.name);
}

// ---------------------------------------------------------------------------
// searchTools — the combined RRF pipeline
// ---------------------------------------------------------------------------

/**
 * Search tools using Reciprocal Rank Fusion over three independent rankers:
 * 1. keywordRank  — exact term matching, ranked by hit count
 * 2. bm25Rank     — probabilistic TF-IDF relevance (Okapi BM25)
 * 3. fuzzyRank    — trigram similarity for typo tolerance
 *
 * Each ranker produces a ranked list; RRF fuses them into a single ranking.
 */
export function searchTools(
  tools: Iterable<OnDemandToolEntry>,
  query: string,
): SearchResult[] {
  const toolArray = [...tools];
  const terms = query.trim();

  // Empty query returns all tools with equal score.
  if (terms.length === 0) {
    return toolArray.map((t) => ({
      name: t.name,
      description: t.description,
      score: 1,
    }));
  }

  const lists = [
    keywordRank(toolArray, query),
    bm25Rank(toolArray, query),
    fuzzyRank(toolArray, query),
  ];

  const fused = reciprocalRankFusion(lists);

  // Attach descriptions from the original tool entries.
  const byName = new Map(toolArray.map((t) => [t.name, t]));
  return fused.map((r) => ({
    ...r,
    description: byName.get(r.name)?.description,
  }));
}
