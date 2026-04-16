import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import type { UserContext } from "./jwt.js";
import {
  handleAdminImpersonation,
  requireAdmin,
  type AuditImpersonationFn,
} from "./admin.js";

function makeRequest(partial: Partial<Request>): Request {
  return partial as Request;
}

function baseUser(over: Partial<UserContext> = {}): UserContext {
  return {
    userId: "admin-1",
    isAdmin: false,
    ...over,
  } as UserContext;
}

describe("handleAdminImpersonation", () => {
  let auditCalls: Parameters<AuditImpersonationFn>[];

  const mockAudit: AuditImpersonationFn = async (...args) => {
    auditCalls.push(args);
  };

  beforeEach(() => {
    auditCalls = [];
  });

  it("non-admin with X-Act-As-User on GET does not impersonate", async () => {
    const req = makeRequest({
      method: "GET",
      headers: { "x-act-as-user": "target-1" },
      url: "/api/v1/x",
      ip: "127.0.0.1",
    });
    const ctx = await handleAdminImpersonation(req, baseUser({ isAdmin: false }), mockAudit);
    assert.equal(ctx.isImpersonating, false);
    assert.equal(ctx.effectiveUserId, "admin-1");
    assert.equal(auditCalls.length, 0);
  });

  it("admin POST with X-Act-As-User does not impersonate (GET-only)", async () => {
    const req = makeRequest({
      method: "POST",
      headers: { "x-act-as-user": "target-1" },
      url: "/api/v1/x",
    });
    const ctx = await handleAdminImpersonation(req, baseUser({ isAdmin: true }), mockAudit);
    assert.equal(ctx.isImpersonating, false);
    assert.equal(ctx.effectiveUserId, "admin-1");
    assert.equal(auditCalls.length, 0);
  });

  it("admin GET without header does not impersonate", async () => {
    const req = makeRequest({
      method: "GET",
      headers: {},
      url: "/api/v1/x",
    });
    const ctx = await handleAdminImpersonation(req, baseUser({ isAdmin: true }), mockAudit);
    assert.equal(ctx.isImpersonating, false);
    assert.equal(ctx.effectiveUserId, "admin-1");
    assert.equal(auditCalls.length, 0);
  });

  it("admin GET with X-Act-As-User impersonates and calls audit", async () => {
    const req = makeRequest({
      method: "GET",
      headers: { "x-act-as-user": "target-99", "user-agent": "jest" },
      url: "/api/v1/me",
      ip: "10.0.0.1",
    });
    const user = baseUser({ userId: "admin-1", isAdmin: true });
    const ctx = await handleAdminImpersonation(req, user, mockAudit);

    assert.equal(ctx.isImpersonating, true);
    assert.equal(ctx.effectiveUserId, "target-99");
    assert.equal(ctx.userId, "admin-1");
    assert.equal(auditCalls.length, 1);
    assert.deepEqual(auditCalls[0], [
      "admin-1",
      "target-99",
      "/api/v1/me",
      "10.0.0.1",
      "jest",
    ]);
  });

  it("preserves original userContext fields on returned object", async () => {
    const user = baseUser({
      userId: "u1",
      isAdmin: true,
      b2cCustomerId: "cust-1",
    } as UserContext);
    const req = makeRequest({
      method: "GET",
      headers: { "x-act-as-user": "other" },
      url: "/x",
    });
    const ctx = await handleAdminImpersonation(req, user, mockAudit);
    assert.equal((ctx as UserContext).b2cCustomerId, "cust-1");
  });
});

describe("requireAdmin", () => {
  it("throws for non-admin", () => {
    assert.throws(
      () => requireAdmin(baseUser({ isAdmin: false })),
      (e: unknown) => e instanceof Error && (e as Error).message === "Admin access required"
    );
  });

  it("does not throw for admin", () => {
    assert.doesNotThrow(() => requireAdmin(baseUser({ isAdmin: true })));
  });
});
