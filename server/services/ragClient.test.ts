import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  toRagScope,
  ragSearch,
  resetRagCircuitStateForTests,
} from "./ragClient.js";

describe("toRagScope", () => {
  it("returns undefined for empty input", () => {
    assert.equal(toRagScope(undefined), undefined);
    assert.equal(toRagScope(null), undefined);
    assert.equal(toRagScope(""), undefined);
  });

  it("maps known household types case-insensitively", () => {
    assert.equal(toRagScope("Individual"), "individual");
    assert.equal(toRagScope("FAMILY"), "family");
    assert.equal(toRagScope("Couple"), "couple");
  });

  it("returns undefined for unknown type", () => {
    assert.equal(toRagScope("enterprise"), undefined);
  });
});

describe("ragSearch feature gate", () => {
  const prevSearch = process.env.USE_GRAPH_SEARCH;
  const prevUrl = process.env.RAG_API_URL;

  beforeEach(() => {
    resetRagCircuitStateForTests();
    process.env.USE_GRAPH_SEARCH = "false";
    process.env.RAG_API_URL = "https://rag.example.com";
  });

  afterEach(() => {
    resetRagCircuitStateForTests();
    if (prevSearch === undefined) delete process.env.USE_GRAPH_SEARCH;
    else process.env.USE_GRAPH_SEARCH = prevSearch;
    if (prevUrl === undefined) delete process.env.RAG_API_URL;
    else process.env.RAG_API_URL = prevUrl;
  });

  it("returns null when graph search flag is off", async () => {
    const out = await ragSearch({ query: "x" });
    assert.equal(out, null);
  });
});
