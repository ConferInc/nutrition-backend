import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isUuid } from "./auditUuid.js";

describe("isUuid", () => {
  it("accepts lowercase v4-style UUID", () => {
    assert.equal(isUuid("550e8400-e29b-41d4-a716-446655440000"), true);
  });

  it("accepts uppercase UUID", () => {
    assert.equal(isUuid("550E8400-E29B-41D4-A716-446655440000"), true);
  });

  it("rejects empty and null", () => {
    assert.equal(isUuid(""), false);
    assert.equal(isUuid(undefined), false);
    assert.equal(isUuid(null), false);
  });

  it("rejects non-UUID strings", () => {
    assert.equal(isUuid("not-a-uuid"), false);
    assert.equal(isUuid("550e8400-e29b-41d4-a716"), false);
  });
});
