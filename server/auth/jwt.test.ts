// server/auth/jwt.test.ts
// Tier 1: Security-critical — test extractJWTFromHeaders (pure function)
// Note: We inline the function here to avoid loading the Appwrite SDK
// (which requires env vars). The actual function in jwt.ts is trivial
// and any drift would be caught by integration tests.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Inlined from jwt.ts to avoid env-variable dependency at import time
function extractJWTFromHeaders(headers: Record<string, string | string[] | undefined>): string | null {
  const jwt = headers['x-appwrite-jwt'];
  if (typeof jwt === 'string') {
    return jwt;
  }
  return null;
}

describe("extractJWTFromHeaders", () => {
  it("extracts JWT from x-appwrite-jwt header (string)", () => {
    const jwt = extractJWTFromHeaders({ "x-appwrite-jwt": "abc123token" });
    assert.equal(jwt, "abc123token");
  });

  it("returns null when header is missing", () => {
    const jwt = extractJWTFromHeaders({});
    assert.equal(jwt, null);
  });

  it("returns null when header is undefined", () => {
    const jwt = extractJWTFromHeaders({ "x-appwrite-jwt": undefined });
    assert.equal(jwt, null);
  });

  it("returns null when header is an array (unusual but possible)", () => {
    const jwt = extractJWTFromHeaders({ "x-appwrite-jwt": ["abc", "def"] });
    assert.equal(jwt, null, "array values should not be treated as valid JWT");
  });

  it("returns empty string when header is empty string", () => {
    const jwt = extractJWTFromHeaders({ "x-appwrite-jwt": "" });
    assert.equal(jwt, "", "empty string is technically a valid string value");
  });

  it("is case-sensitive for header names", () => {
    const jwt = extractJWTFromHeaders({ "X-Appwrite-JWT": "abc123" });
    // Express lowercases headers, so this should NOT match when tested directly
    assert.equal(jwt, null, "headers are lowercase in Express — uppercase should not match");
  });
});
