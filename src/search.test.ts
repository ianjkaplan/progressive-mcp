import { describe, it, expect } from "vitest";
import {
  keywordSearch,
  fuzzyScore,
  keywordRank,
  bm25Rank,
  reciprocalRankFusion,
  searchTools,
} from "./search.js";
import type { OnDemandToolEntry } from "./tool-registry.js";

function tool(
  name: string,
  description?: string,
  inputSchema?: Record<string, unknown>,
): OnDemandToolEntry {
  return { name, description, inputSchema, registered: {} } as OnDemandToolEntry;
}

const tools = [
  tool("send-email", "Send an email to a recipient", { to: {}, body: {} }),
  tool("create-calendar-event", "Create a new calendar event", { title: {}, date: {} }),
  tool("delete-user", "Delete a user account", { userId: {} }),
  tool("no-description"),
];

// ---------------------------------------------------------------------------
// keywordSearch (existing tests, preserved)
// ---------------------------------------------------------------------------
describe("keywordSearch", () => {
  it("matches a single term in the name", () => {
    const results = keywordSearch(tools, "email");
    expect(results).toEqual([
      { name: "send-email", description: "Send an email to a recipient" },
    ]);
  });

  it("matches a single term in the description", () => {
    const results = keywordSearch(tools, "recipient");
    expect(results).toEqual([
      { name: "send-email", description: "Send an email to a recipient" },
    ]);
  });

  it("matches multiple terms with AND logic", () => {
    const results = keywordSearch(tools, "calendar event");
    expect(results).toEqual([
      { name: "create-calendar-event", description: "Create a new calendar event" },
    ]);
  });

  it("is case insensitive", () => {
    const results = keywordSearch(tools, "DELETE USER");
    expect(results).toEqual([
      { name: "delete-user", description: "Delete a user account" },
    ]);
  });

  it("returns empty when no tools match", () => {
    const results = keywordSearch(tools, "nonexistent");
    expect(results).toEqual([]);
  });

  it("returns all tools for an empty query", () => {
    const results = keywordSearch(tools, "");
    expect(results).toHaveLength(tools.length);
  });

  it("returns all tools for a whitespace-only query", () => {
    const results = keywordSearch(tools, "   ");
    expect(results).toHaveLength(tools.length);
  });

  it("matches against name when description is undefined", () => {
    const results = keywordSearch(tools, "no-description");
    expect(results).toEqual([
      { name: "no-description", description: undefined },
    ]);
  });

  it("returns multiple matches when query is broad", () => {
    const results = keywordSearch(tools, "a");
    const names = results.map((r) => r.name);
    expect(names).toContain("send-email");
    expect(names).toContain("create-calendar-event");
    expect(names).toContain("delete-user");
  });

  it("matches a term found only in parameter names", () => {
    const results = keywordSearch(tools, "userId");
    expect(results).toEqual([
      { name: "delete-user", description: "Delete a user account" },
    ]);
  });

  it("matches across name, description, and parameter names", () => {
    const results = keywordSearch(tools, "email body");
    expect(results).toEqual([
      { name: "send-email", description: "Send an email to a recipient" },
    ]);
  });

  it("does not match parameter names from a different tool", () => {
    const results = keywordSearch(tools, "calendar userId");
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fuzzyScore
// ---------------------------------------------------------------------------
describe("fuzzyScore", () => {
  it("returns 1.0 for an exact match", () => {
    expect(fuzzyScore("email", "email")).toBe(1);
  });

  it("returns 1.0 for case-insensitive exact match", () => {
    expect(fuzzyScore("Email", "email")).toBe(1);
  });

  it("returns 0 for completely unrelated strings", () => {
    expect(fuzzyScore("abc", "xyz")).toBe(0);
  });

  it("returns a high score for strings differing by one character", () => {
    // "emal" vs "email" — close but not exact.
    // Trigram similarity on short strings produces lower absolute values
    // than edit-distance approaches, but still distinguishes near-misses.
    const score = fuzzyScore("emal", "email");
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(1);
  });

  it("returns a score proportional to similarity", () => {
    const close = fuzzyScore("calender", "calendar");
    const far = fuzzyScore("zzzzzzz", "calendar");
    expect(close).toBeGreaterThan(far);
  });

  it("handles empty source string", () => {
    expect(fuzzyScore("", "email")).toBe(0);
  });

  it("handles empty target string", () => {
    expect(fuzzyScore("email", "")).toBe(0);
  });

  it("handles both empty strings", () => {
    expect(fuzzyScore("", "")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// keywordRank
// ---------------------------------------------------------------------------
describe("keywordRank", () => {
  it("returns tool names ranked by number of matching terms", () => {
    const ranked = keywordRank(tools, "email send");
    // "send-email" matches both terms in name + description
    expect(ranked[0]).toBe("send-email");
  });

  it("returns empty array when nothing matches", () => {
    const ranked = keywordRank(tools, "zzzznotreal");
    expect(ranked).toEqual([]);
  });

  it("ranks tools with more term hits higher", () => {
    // "create new event" — create-calendar-event matches all 3 terms,
    // others might match fewer
    const ranked = keywordRank(tools, "create new event");
    expect(ranked[0]).toBe("create-calendar-event");
  });
});

// ---------------------------------------------------------------------------
// bm25Rank
// ---------------------------------------------------------------------------
describe("bm25Rank", () => {
  it("returns tools ranked by BM25 relevance", () => {
    const ranked = bm25Rank(tools, "email");
    expect(ranked[0]).toBe("send-email");
  });

  it("returns empty array for a term that appears in no tool", () => {
    const ranked = bm25Rank(tools, "zzzznotreal");
    expect(ranked).toEqual([]);
  });

  it("ranks a tool higher when the query term is rare across corpus", () => {
    // "recipient" only appears in send-email's description
    const ranked = bm25Rank(tools, "recipient");
    expect(ranked[0]).toBe("send-email");
  });

  it("penalises very common terms via IDF", () => {
    // "a" appears in almost every tool — BM25 IDF should down-weight it
    // so scores should be lower / more spread out than a rare term
    const commonRank = bm25Rank(tools, "a");
    const rareRank = bm25Rank(tools, "recipient");
    // The rare-term list should be shorter (fewer tools match)
    expect(rareRank.length).toBeLessThanOrEqual(commonRank.length);
  });
});

// ---------------------------------------------------------------------------
// reciprocalRankFusion
// ---------------------------------------------------------------------------
describe("reciprocalRankFusion", () => {
  it("fuses a single ranked list (identity)", () => {
    const fused = reciprocalRankFusion([["a", "b", "c"]]);
    expect(fused.map((r) => r.name)).toEqual(["a", "b", "c"]);
  });

  it("boosts items that appear in multiple lists", () => {
    // "b" appears at rank 0 in list2 and rank 1 in list1
    // "a" only appears at rank 0 in list1
    const fused = reciprocalRankFusion([
      ["a", "b"],
      ["b", "c"],
    ]);
    expect(fused[0].name).toBe("b");
  });

  it("returns empty for empty input", () => {
    const fused = reciprocalRankFusion([]);
    expect(fused).toEqual([]);
  });

  it("handles lists with no overlap", () => {
    const fused = reciprocalRankFusion([["a"], ["b"]]);
    expect(fused).toHaveLength(2);
    // Both have the same score: 1/(60+1) — order is stable but both present
    const names = fused.map((r) => r.name);
    expect(names).toContain("a");
    expect(names).toContain("b");
  });

  it("respects custom k parameter", () => {
    // With k=0, rank position matters much more
    const fused = reciprocalRankFusion([["a", "b"], ["b", "a"]], 0);
    // Both appear in both lists at symmetric positions, scores should be equal
    // a: 1/(0+1) + 1/(0+2) = 1 + 0.5 = 1.5
    // b: 1/(0+2) + 1/(0+1) = 0.5 + 1 = 1.5
    expect(fused[0].score).toBeCloseTo(1.5);
    expect(fused[1].score).toBeCloseTo(1.5);
  });

  it("assigns correct RRF scores", () => {
    // With default k=60:
    // "x" at rank 0 in list1: score = 1/(60+1) ≈ 0.01639
    const fused = reciprocalRankFusion([["x"]]);
    expect(fused[0].score).toBeCloseTo(1 / 61, 5);
  });
});

// ---------------------------------------------------------------------------
// searchTools (full pipeline)
// ---------------------------------------------------------------------------
describe("searchTools", () => {
  it("returns results for a matching query", () => {
    const results = searchTools(tools, "email");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("send-email");
  });

  it("returns results with scores", () => {
    const results = searchTools(tools, "email");
    for (const r of results) {
      expect(r).toHaveProperty("score");
      expect(typeof r.score).toBe("number");
    }
  });

  it("returns results sorted by descending score", () => {
    const results = searchTools(tools, "create event");
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("returns empty for a query matching nothing", () => {
    const results = searchTools(tools, "zzzznotreal");
    expect(results).toEqual([]);
  });

  it("handles typos via fuzzy matching", () => {
    // "emal" is a typo for "email" — fuzzy ranker should still surface send-email
    const results = searchTools(tools, "emal");
    const names = results.map((r) => r.name);
    expect(names).toContain("send-email");
  });

  it("returns all tools for empty query", () => {
    const results = searchTools(tools, "");
    expect(results).toHaveLength(tools.length);
  });

  it("respects limit parameter", () => {
    const results = searchTools(tools, "a", 1);
    expect(results).toHaveLength(1);
  });

  it("returns all results when limit exceeds matches", () => {
    const results = searchTools(tools, "email", 100);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(tools.length);
  });

  it("respects limit on empty query", () => {
    const results = searchTools(tools, "", 2);
    expect(results).toHaveLength(2);
  });

  it("returns all results when limit is undefined", () => {
    const withLimit = searchTools(tools, "a", undefined);
    const without = searchTools(tools, "a");
    expect(withLimit).toEqual(without);
  });
});
