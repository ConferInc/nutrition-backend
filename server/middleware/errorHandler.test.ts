import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import { AppError, errorHandler, notFoundHandler } from "./errorHandler.js";

let origConsoleError: typeof console.error;
before(() => {
  origConsoleError = console.error;
  console.error = () => {};
});
after(() => {
  console.error = origConsoleError;
});

function mockRes() {
  const data: { status?: number; body?: unknown; contentType?: string } = {};
  const res = {
    headersSent: false,
    statusCode: 200,
    status(code: number) {
      data.status = code;
      return this;
    },
    type(t: string) {
      data.contentType = t;
      return this;
    },
    json(body: unknown) {
      data.body = body;
      return this;
    },
    _data: data,
  } as unknown as Response & { _data: typeof data };
  return res;
}

function mockReq(url = "/test", path = "/test"): Request {
  return { url, path } as Request;
}

describe("AppError", () => {
  it("sets name and extra fields", () => {
    const err = new AppError(400, "Bad", "detail", "urn:problem", { foo: 1 });
    assert.equal(err.name, "AppError");
    assert.equal(err.status, 400);
    assert.equal(err.type, "urn:problem");
    assert.equal(err.extra?.foo, 1);
  });

  it("defaults type to about:blank", () => {
    const err = new AppError(500, "T", "d");
    assert.equal(err.type, "about:blank");
  });
});

describe("errorHandler", () => {
  it("maps AppError to RFC 7807 JSON", () => {
    const req = mockReq();
    const res = mockRes();
    const next = (() => {}) as NextFunction;
    const err = new AppError(422, "Unprocessable", "bad input", "urn:x", { hint: "a" });
    errorHandler(err, req, res, next);
    assert.equal(res._data.status, 422);
    assert.equal(res._data.contentType, "application/problem+json");
    const body = res._data.body as Record<string, unknown>;
    assert.equal(body.status, 422);
    assert.equal(body.title, "Unprocessable");
    assert.equal(body.detail, "bad input");
    assert.equal(body.type, "urn:x");
    assert.equal(body.instance, "/test");
    assert.equal(body.hint, "a");
  });

  it("maps ValidationError by name", () => {
    const req = mockReq();
    const res = mockRes();
    const err: any = new Error("x");
    err.name = "ValidationError";
    err.details = [{ path: "a" }];
    errorHandler(err, req, res, () => {});
    assert.equal(res._data.status, 400);
    const body = res._data.body as Record<string, unknown>;
    assert.equal(body.title, "Validation Error");
    assert.ok(Array.isArray(body.errors));
  });

  it("maps err.validation without ValidationError name", () => {
    const req = mockReq();
    const res = mockRes();
    const err: any = new Error("x");
    err.validation = { field: ["required"] };
    errorHandler(err, req, res, () => {});
    assert.equal(res._data.status, 400);
    const body = res._data.body as Record<string, unknown>;
    assert.equal(body.errors, err.validation);
  });

  it("maps PG 23505 to 409", () => {
    const req = mockReq();
    const res = mockRes();
    const err: any = new Error("dup");
    err.code = "23505";
    errorHandler(err, req, res, () => {});
    assert.equal(res._data.status, 409);
    const body = res._data.body as Record<string, unknown>;
    assert.equal(body.title, "Duplicate Resource");
  });

  it("maps PG 23503 to 400", () => {
    const req = mockReq();
    const res = mockRes();
    const err: any = new Error("fk");
    err.code = "23503";
    errorHandler(err, req, res, () => {});
    assert.equal(res._data.status, 400);
  });

  it("maps PG 42703 to 503 with migration hint", () => {
    const req = mockReq();
    const res = mockRes();
    const err: any = new Error("col");
    err.code = "42703";
    errorHandler(err, req, res, () => {});
    assert.equal(res._data.status, 503);
    const body = res._data.body as Record<string, unknown>;
    assert.equal(body.title, "Database Schema Out of Date");
    assert.ok(String(body.migration).length > 0);
  });

  it("maps err.status 404", () => {
    const req = mockReq();
    const res = mockRes();
    const err: any = new Error("missing");
    err.status = 404;
    errorHandler(err, req, res, () => {});
    assert.equal(res._data.status, 404);
    const body = res._data.body as Record<string, unknown>;
    assert.equal(body.title, "Not Found");
  });

  it("maps err.status 422", () => {
    const req = mockReq();
    const res = mockRes();
    const err: any = new Error("nope");
    err.status = 422;
    errorHandler(err, req, res, () => {});
    assert.equal(res._data.status, 422);
    const body = res._data.body as Record<string, unknown>;
    assert.equal(body.title, "Unprocessable Entity");
  });

  it("maps err.statusCode when status absent", () => {
    const req = mockReq();
    const res = mockRes();
    const err: any = new Error("bad");
    err.statusCode = 400;
    errorHandler(err, req, res, () => {});
    assert.equal(res._data.status, 400);
  });

  it("maps unknown error to 500", () => {
    const req = mockReq();
    const res = mockRes();
    errorHandler(new Error("oops"), req, res, () => {});
    assert.equal(res._data.status, 500);
    const body = res._data.body as Record<string, unknown>;
    assert.equal(body.title, "Internal Server Error");
  });

  it("delegates to next when headers already sent", () => {
    const req = mockReq();
    const res = mockRes();
    res.headersSent = true;
    let passed: unknown;
    const next = (e: unknown) => {
      passed = e;
    };
    const err = new Error("late");
    errorHandler(err, req, res, next as NextFunction);
    assert.equal(passed, err);
    assert.equal(res._data.status, undefined);
  });
});

describe("notFoundHandler", () => {
  it("returns 404 with path in detail", () => {
    const req = mockReq("/missing", "/api/foo");
    const res = mockRes();
    notFoundHandler(req, res);
    assert.equal(res._data.status, 404);
    const body = res._data.body as Record<string, unknown>;
    assert.match(String(body.detail), /\/api\/foo/);
  });
});
