import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "./errorHandler.js";
import { requireHouseholdRole, requireProfileEditAccess } from "./householdPermission.js";

function runMiddleware(
  mw: (req: Request, res: Response, next: NextFunction) => void,
  req: Partial<Request>
): Promise<{ err?: unknown; called?: boolean }> {
  return new Promise((resolve) => {
    const res = {} as Response;
    mw(req as Request, res, (err?: unknown) => {
      if (err) resolve({ err });
      else resolve({ called: true });
    });
  });
}

describe("requireHouseholdRole", () => {
  it("403 when req.user is undefined", async () => {
    const mw = requireHouseholdRole("primary_adult");
    const r = await runMiddleware(mw, { user: undefined });
    assert.ok(r.err instanceof AppError);
    assert.equal((r.err as AppError).status, 403);
    assert.match((r.err as AppError).detail, /No household role/);
  });

  it("403 when householdRole is missing", async () => {
    const mw = requireHouseholdRole("primary_adult");
    const r = await runMiddleware(mw, { user: { userId: "1" } } as any);
    assert.ok(r.err instanceof AppError);
    assert.equal((r.err as AppError).status, 403);
  });

  it("403 when role not allowed", async () => {
    const mw = requireHouseholdRole("primary_adult");
    const r = await runMiddleware(mw, {
      user: { householdRole: "child" },
    } as any);
    assert.ok(r.err instanceof AppError);
    assert.equal((r.err as AppError).status, 403);
    assert.match((r.err as AppError).detail, /primary_adult/);
  });

  it("calls next when single role matches", async () => {
    const mw = requireHouseholdRole("primary_adult");
    const r = await runMiddleware(mw, {
      user: { householdRole: "primary_adult" },
    } as any);
    assert.equal(r.called, true);
  });

  it("calls next when one of multiple roles matches", async () => {
    const mw = requireHouseholdRole("primary_adult", "secondary_adult");
    const r = await runMiddleware(mw, {
      user: { householdRole: "secondary_adult" },
    } as any);
    assert.equal(r.called, true);
  });
});

describe("requireProfileEditAccess", () => {
  it("allows owner editing own profile (params.id)", async () => {
    const r = await new Promise<{ err?: unknown; ok?: boolean }>((resolve) => {
      const req = {
        user: { b2cCustomerId: "c1", householdRole: "child" },
        params: { id: "c1" },
      } as any;
      requireProfileEditAccess(req, {} as Response, (err?: unknown) => {
        resolve(err ? { err } : { ok: true });
      });
    });
    assert.equal(r.ok, true);
  });

  it("allows primary_adult editing another member", async () => {
    const r = await new Promise<{ ok?: boolean }>((resolve) => {
      const req = {
        user: { b2cCustomerId: "c1", householdRole: "primary_adult" },
        params: { id: "c2" },
      } as any;
      requireProfileEditAccess(req, {} as Response, (err?: unknown) => {
        resolve(err ? {} : { ok: true });
      });
    });
    assert.equal(r.ok, true);
  });

  it("denies secondary_adult editing another member", async () => {
    const r = await new Promise<{ err?: unknown }>((resolve) => {
      const req = {
        user: { b2cCustomerId: "c1", householdRole: "secondary_adult" },
        params: { id: "c2" },
      } as any;
      requireProfileEditAccess(req, {} as Response, (err?: unknown) => {
        resolve({ err });
      });
    });
    assert.ok(r.err instanceof AppError);
    assert.equal((r.err as AppError).status, 403);
  });

  it("denies child editing another member", async () => {
    const r = await new Promise<{ err?: unknown }>((resolve) => {
      const req = {
        user: { b2cCustomerId: "c1", householdRole: "child" },
        params: { id: "c2" },
      } as any;
      requireProfileEditAccess(req, {} as Response, (err?: unknown) => {
        resolve({ err });
      });
    });
    assert.ok(r.err instanceof AppError);
  });

  it("allows owner when target is memberId fallback", async () => {
    const r = await new Promise<{ ok?: boolean }>((resolve) => {
      const req = {
        user: { b2cCustomerId: "c1", householdRole: "child" },
        params: { memberId: "c1" },
      } as any;
      requireProfileEditAccess(req, {} as Response, (err?: unknown) => {
        resolve(err ? {} : { ok: true });
      });
    });
    assert.equal(r.ok, true);
  });
});
