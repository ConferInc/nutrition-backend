import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import {
  idempotencyMiddleware,
  storeIdempotentResponse,
  clearIdempotencyStoreForTests,
} from "./idempotency.js";

beforeEach(() => {
  clearIdempotencyStoreForTests();
});

afterEach(() => {
  clearIdempotencyStoreForTests();
});

function chainRes() {
  const state: { statusCode?: number; body?: unknown; locals: Record<string, unknown> } = {
    locals: {},
  };
  const res = {
    locals: state.locals,
    statusCode: 200,
    status(code: number) {
      state.statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
    _state: state,
  } as Response & { _state: typeof state };
  return res;
}

describe("idempotencyMiddleware", () => {
  it("skips when no Idempotency-Key", async () => {
    const res = chainRes();
    await new Promise<void>((resolve) => {
      idempotencyMiddleware(
        { method: "POST", path: "/a", body: {}, headers: {} } as Request,
        res,
        () => resolve()
      );
    });
    assert.equal(res.locals.idempotencyKey, undefined);
  });

  it("sets res.locals.idempotencyKey for new key", async () => {
    const res = chainRes();
    await new Promise<void>((resolve) => {
      idempotencyMiddleware(
        {
          method: "POST",
          path: "/api/x",
          body: { n: 1 },
          headers: { "idempotency-key": "new-key" },
        } as Request,
        res,
        () => resolve()
      );
    });
    assert.equal(res.locals.idempotencyKey, "new-key");
  });

  it("replays stored response on duplicate request", async () => {
    const req = {
      method: "POST",
      path: "/api/r",
      body: { same: true },
      headers: { "idempotency-key": "replay-key" },
    } as Request;

    const res1 = chainRes();
    await new Promise<void>((r) => idempotencyMiddleware(req, res1, () => r()));
    await new Promise<void>((r) => storeIdempotentResponse(req, res1, () => r()));
    res1.status(201);
    (res1 as any).json({ created: true });

    const res2 = chainRes();
    let nextCalled = false;
    idempotencyMiddleware(req, res2, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res2._state.statusCode, 201);
    assert.deepEqual(res2._state.body, { created: true });
  });

  it("409 when key reused with different method", async () => {
    const reqPost = {
      method: "POST",
      path: "/p",
      body: {},
      headers: { "idempotency-key": "m1" },
    } as Request;
    await new Promise<void>((r) => idempotencyMiddleware(reqPost, chainRes(), () => r()));

    const res = chainRes();
    idempotencyMiddleware(
      {
        method: "GET",
        path: "/p",
        body: {},
        headers: { "idempotency-key": "m1" },
      } as Request,
      res,
      () => assert.fail("next must not run on 409")
    );
    assert.equal(res._state.statusCode, 409);
    assert.match(String((res._state.body as any)?.detail), /method or path/i);
  });

  it("409 when key reused with different body", async () => {
    await new Promise<void>((r) =>
      idempotencyMiddleware(
        {
          method: "POST",
          path: "/p",
          body: { a: 1 },
          headers: { "idempotency-key": "b1" },
        } as Request,
        chainRes(),
        () => r()
      )
    );
    const res = chainRes();
    idempotencyMiddleware(
      {
        method: "POST",
        path: "/p",
        body: { a: 2 },
        headers: { "idempotency-key": "b1" },
      } as Request,
      res,
      () => assert.fail("next must not run on 409")
    );
    assert.equal(res._state.statusCode, 409);
  });

  it("treats expired record as new request", async () => {
    const realNow = Date.now;
    let t = 1_700_000_000_000;
    Date.now = () => t;

    const req = {
      method: "POST",
      path: "/p",
      body: {},
      headers: { "idempotency-key": "exp-k" },
    } as Request;

    const resA = chainRes();
    await new Promise<void>((r) => idempotencyMiddleware(req, resA, () => r()));

    t += 20 * 60 * 1000;

    const resB = chainRes();
    await new Promise<void>((r) => idempotencyMiddleware(req, resB, () => r()));
    assert.equal(resB.locals.idempotencyKey, "exp-k");

    Date.now = realNow;
  });
});

describe("storeIdempotentResponse", () => {
  it("stores response body for POST after json()", async () => {
    const req = {
      method: "POST",
      path: "/x",
      body: {},
      headers: { "idempotency-key": "save-k" },
    } as Request;

    const resA = chainRes();
    await new Promise<void>((r) => idempotencyMiddleware(req, resA, () => r()));
    await new Promise<void>((r) => storeIdempotentResponse(req, resA, () => r()));
    resA.status(202);
    (resA as any).json({ queued: true });

    const resB = chainRes();
    let nextAfterReplay = false;
    idempotencyMiddleware(req, resB, () => {
      nextAfterReplay = true;
    });
    assert.equal(nextAfterReplay, false);
    assert.equal(resB._state.statusCode, 202);
    assert.deepEqual(resB._state.body, { queued: true });
  });

  it("invokes next for storeIdempotentResponse when chain continues", async () => {
    const req = { method: "POST", path: "/x", body: {} } as Request;
    const res: any = { locals: {} };
    let nexted = false;
    await new Promise<void>((r) =>
      storeIdempotentResponse(req, res, () => {
        nexted = true;
        r();
      })
    );
    assert.equal(nexted, true);
  });
});
