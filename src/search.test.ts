import { describe, it, expect } from "vitest";
import { keywordSearch } from "./search.js";
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
