import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  fuzzyScore,
  keywordRank,
  bm25Rank,
  reciprocalRankFusion,
  searchTools,
} from "./search.js";
import type { OnDemandToolEntry } from "./tool-registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Arbitrary that produces non-empty printable strings. */
const nonEmptyStr = fc.string({ minLength: 1, maxLength: 50 });

/** Arbitrary that produces tool-like names (lowercase, hyphenated). */
const toolName = fc
  .array(fc.stringMatching(/^[a-z]{1,10}$/), {
    minLength: 1,
    maxLength: 3,
  })
  .map((parts) => parts.join("-"));

function tool(
  name: string,
  description?: string,
  inputSchema?: Record<string, unknown>,
): OnDemandToolEntry {
  return { name, description, inputSchema, registered: {} } as OnDemandToolEntry;
}

/** Arbitrary that produces a list of unique tool entries. */
const toolList = fc
  .uniqueArray(
    fc.tuple(toolName, fc.option(fc.string({ minLength: 0, maxLength: 80 }), { nil: undefined })),
    { minLength: 1, maxLength: 20, selector: ([name]) => name },
  )
  .map((entries) => entries.map(([name, desc]) => tool(name, desc)));

// ---------------------------------------------------------------------------
// fuzzyScore properties
// ---------------------------------------------------------------------------
describe("fuzzyScore properties", () => {
  it("always returns a value in [0, 1]", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const score = fuzzyScore(a, b);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("identity: fuzzyScore(s, s) === 1 for any non-empty string", () => {
    fc.assert(
      fc.property(nonEmptyStr, (s) => {
        expect(fuzzyScore(s, s)).toBe(1);
      }),
    );
  });

  it("symmetry: fuzzyScore(a, b) === fuzzyScore(b, a)", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        expect(fuzzyScore(a, b)).toBe(fuzzyScore(b, a));
      }),
    );
  });

  it("empty vs non-empty is always 0", () => {
    fc.assert(
      fc.property(nonEmptyStr, (s) => {
        expect(fuzzyScore("", s)).toBe(0);
        expect(fuzzyScore(s, "")).toBe(0);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// reciprocalRankFusion properties
// ---------------------------------------------------------------------------
describe("reciprocalRankFusion properties", () => {
  /** Arbitrary: list of ranked lists of unique names drawn from a shared pool. */
  const rankedLists = fc
    .uniqueArray(toolName, { minLength: 1, maxLength: 15 })
    .chain((pool) =>
      fc.array(fc.shuffledSubarray(pool, { minLength: 1 }), {
        minLength: 1,
        maxLength: 5,
      }),
    );

  it("output contains exactly the union of all input items", () => {
    fc.assert(
      fc.property(rankedLists, (lists) => {
        const fused = reciprocalRankFusion(lists);
        const expected = new Set(lists.flat());
        const actual = new Set(fused.map((r) => r.name));
        expect(actual).toEqual(expected);
      }),
    );
  });

  it("all scores are positive", () => {
    fc.assert(
      fc.property(rankedLists, (lists) => {
        const fused = reciprocalRankFusion(lists);
        for (const r of fused) {
          expect(r.score).toBeGreaterThan(0);
        }
      }),
    );
  });

  it("no duplicate items in output", () => {
    fc.assert(
      fc.property(rankedLists, (lists) => {
        const fused = reciprocalRankFusion(lists);
        const names = fused.map((r) => r.name);
        expect(new Set(names).size).toBe(names.length);
      }),
    );
  });

  it("monotonicity: adding a list where X ranks first never decreases X's score", () => {
    fc.assert(
      fc.property(rankedLists, fc.constantFrom(..."abcdefghij"), (lists, x) => {
        const baseFused = reciprocalRankFusion(lists);
        const baseScore = baseFused.find((r) => r.name === x)?.score ?? 0;

        // Add a new list where x is ranked first.
        const boosted = reciprocalRankFusion([...lists, [x]]);
        const boostedScore = boosted.find((r) => r.name === x)?.score ?? 0;

        expect(boostedScore).toBeGreaterThanOrEqual(baseScore);
      }),
    );
  });

  it("deterministic: same inputs always produce the same output", () => {
    fc.assert(
      fc.property(rankedLists, (lists) => {
        const a = reciprocalRankFusion(lists);
        const b = reciprocalRankFusion(lists);
        expect(a).toEqual(b);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// keywordRank properties
// ---------------------------------------------------------------------------
describe("keywordRank properties", () => {
  it("output is always a subset of input tool names", () => {
    fc.assert(
      fc.property(toolList, fc.string({ maxLength: 30 }), (tools, query) => {
        const ranked = keywordRank(tools, query);
        const validNames = new Set(tools.map((t) => t.name));
        for (const name of ranked) {
          expect(validNames.has(name)).toBe(true);
        }
      }),
    );
  });

  it("no duplicates in output", () => {
    fc.assert(
      fc.property(toolList, fc.string({ maxLength: 30 }), (tools, query) => {
        const ranked = keywordRank(tools, query);
        expect(new Set(ranked).size).toBe(ranked.length);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// bm25Rank properties
// ---------------------------------------------------------------------------
describe("bm25Rank properties", () => {
  it("output is always a subset of input tool names", () => {
    fc.assert(
      fc.property(toolList, fc.string({ maxLength: 30 }), (tools, query) => {
        const ranked = bm25Rank(tools, query);
        const validNames = new Set(tools.map((t) => t.name));
        for (const name of ranked) {
          expect(validNames.has(name)).toBe(true);
        }
      }),
    );
  });

  it("no duplicates in output", () => {
    fc.assert(
      fc.property(toolList, fc.string({ maxLength: 30 }), (tools, query) => {
        const ranked = bm25Rank(tools, query);
        expect(new Set(ranked).size).toBe(ranked.length);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// searchTools properties
// ---------------------------------------------------------------------------
describe("searchTools properties", () => {
  it("results are sorted descending by score", () => {
    fc.assert(
      fc.property(toolList, fc.string({ maxLength: 30 }), (tools, query) => {
        const results = searchTools(tools, query);
        for (let i = 1; i < results.length; i++) {
          expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
        }
      }),
    );
  });

  it("every returned name exists in the input tools", () => {
    fc.assert(
      fc.property(toolList, fc.string({ maxLength: 30 }), (tools, query) => {
        const results = searchTools(tools, query);
        const validNames = new Set(tools.map((t) => t.name));
        for (const r of results) {
          expect(validNames.has(r.name)).toBe(true);
        }
      }),
    );
  });

  it("no duplicate names in results", () => {
    fc.assert(
      fc.property(toolList, fc.string({ maxLength: 30 }), (tools, query) => {
        const results = searchTools(tools, query);
        const names = results.map((r) => r.name);
        expect(new Set(names).size).toBe(names.length);
      }),
    );
  });

  it("all scores are positive", () => {
    fc.assert(
      fc.property(toolList, nonEmptyStr, (tools, query) => {
        const results = searchTools(tools, query);
        for (const r of results) {
          expect(r.score).toBeGreaterThan(0);
        }
      }),
    );
  });
});
