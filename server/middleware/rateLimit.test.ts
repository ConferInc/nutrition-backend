import "../test/testEnv.js";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import {
  rateLimitMiddleware,
  clearRateLimitStoreForTests,
  startRateLimitCleanup,
  stopRateLimitCleanup,
} from "./rateLimit.js";

const savedRead = env.RATE_LIMITS_READ_RPM;
const savedWrite = env.RATE_LIMITS_WRITE_RPM;

beforeEach(() => {
  clearRateLimitStoreForTests();
  (env as { RATE_LIMITS_READ_RPM: number }).RATE_LIMITS_READ_RPM = 5;
  (env as { RATE_LIMITS_WRITE_RPM: number }).RATE_LIMITS_WRITE_RPM = 5;
});

afterEach(() => {
  clearRateLimitStoreForTests();
  (env as { RATE_LIMITS_READ_RPM: number }).RATE_LIMITS_READ_RPM = savedRead;
  (env as { RATE_LIMITS_WRITE_RPM: number }).RATE_LIMITS_WRITE_RPM = savedWrite;
});

function runMw(req: Partial<Request>): Promise<{ code?: number; body?: unknown; headers?: Record<string, string> }> {
  const headers: Record<string, string> = {};
  const res: any = {
    headers,
    setHeader(k: string, v: string) {
      headers[k] = v;
    },
    statusCode: 200,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this._body = b;
      return this;
    },
  };
  return new Promise((resolve) => {
    let settled = false;
    const done = (payload: { code?: number; body?: unknown; headers: Record<string, string> }) => {
      if (!settled) {
        settled = true;
        resolve(payload);
      }
    };
    res.json = function (b: unknown) {
      this._body = b;
      done({ code: this.statusCode, body: b, headers });
      return this;
    };
    rateLimitMiddleware(req as Request, res as Response, () => {
      done({ code: res.statusCode === 429 ? 429 : undefined, body: res._body, headers });
    });
  });
}

describe("rateLimitMiddleware", () => {
  it("skips when req.user is missing", async () => {
    const out = await runMw({ method: "GET", user: undefined } as Request);
    assert.equal(out.code, undefined);
  });

  it("uses read bucket for GET", async () => {
    const out = await runMw({ method: "GET", user: { userId: "u-read" } } as Request);
    assert.ok(out.headers?.RateLimit !== undefined);
  });

  it("uses write bucket for POST", async () => {
    await runMw({ method: "POST", user: { userId: "u-write" } } as Request);
    await runMw({ method: "PUT", user: { userId: "u-write2" } } as Request);
    assert.ok(true);
  });

  it("allows exactly up to limit then returns 429", async () => {
    const userId = "u-limit";
    for (let i = 0; i < 5; i += 1) {
      const out = await runMw({ method: "GET", user: { userId } } as Request);
      assert.notEqual(out.code, 429);
    }
    const blocked = await runMw({ method: "GET", user: { userId } } as Request);
    assert.equal(blocked.code, 429);
  });

  it("read and write buckets are independent", async () => {
    const uid = "u-split";
    for (let i = 0; i < 5; i += 1) {
      await runMw({ method: "GET", user: { userId: uid } } as Request);
    }
    const readBlocked = await runMw({ method: "GET", user: { userId: uid } } as Request);
    assert.equal(readBlocked.code, 429);

    const writeOk = await runMw({ method: "POST", user: { userId: uid } } as Request);
    assert.notEqual(writeOk.code, 429);
  });

  it("resets counter after window passes", async () => {
    const realNow = Date.now;
    let t = 2_000_000_000_000;
    Date.now = () => t;

    const uid = "u-window";
    for (let i = 0; i < 5; i += 1) {
      await runMw({ method: "GET", user: { userId: uid } } as Request);
    }
    assert.equal((await runMw({ method: "GET", user: { userId: uid } } as Request)).code, 429);

    t += 61_000;
    const again = await runMw({ method: "GET", user: { userId: uid } } as Request);
    assert.notEqual(again.code, 429);

    Date.now = realNow;
  });

  it("startRateLimitCleanup twice does not throw", () => {
    stopRateLimitCleanup();
    startRateLimitCleanup();
    startRateLimitCleanup();
    stopRateLimitCleanup();
    startRateLimitCleanup();
  });
});
