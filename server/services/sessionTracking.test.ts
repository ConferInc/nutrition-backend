// Pure helpers inlined from sessionTracking.ts (avoids DB import at load time).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";

interface UAInfo {
  deviceType: string;
  browser: string;
  os: string;
}

function parseUserAgent(ua: string | undefined): UAInfo {
  if (!ua) return { deviceType: "unknown", browser: "unknown", os: "unknown" };

  let deviceType = "desktop";
  if (/Mobi|Android.*Mobile|iPhone|iPod/i.test(ua)) deviceType = "mobile";
  else if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) deviceType = "tablet";

  let browser = "unknown";
  const edgeMatch = ua.match(/Edg(?:e|A|iOS)?\/(\d+)/);
  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  const firefoxMatch = ua.match(/Firefox\/(\d+)/);
  const safariMatch = ua.match(/Version\/(\d+).*Safari/);
  const operaMatch = ua.match(/OPR\/(\d+)/);

  if (operaMatch) browser = `Opera ${operaMatch[1]}`;
  else if (edgeMatch) browser = `Edge ${edgeMatch[1]}`;
  else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1]}`;
  else if (safariMatch) browser = `Safari ${safariMatch[1]}`;
  else if (chromeMatch) browser = `Chrome ${chromeMatch[1]}`;

  let os = "unknown";
  if (/Windows NT 10/i.test(ua)) os = "Windows 10/11";
  else if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/Mac OS X (\d+[._]\d+)/i.test(ua)) {
    const ver = ua.match(/Mac OS X (\d+[._]\d+)/i)?.[1]?.replace(/_/g, ".");
    os = `macOS ${ver}`;
  } else if (/iPhone OS (\d+)/i.test(ua)) {
    os = `iOS ${ua.match(/iPhone OS (\d+)/i)?.[1]}`;
  } else if (/iPad.*OS (\d+)/i.test(ua)) {
    os = `iPadOS ${ua.match(/iPad.*OS (\d+)/i)?.[1]}`;
  } else if (/Android (\d+)/i.test(ua)) {
    os = `Android ${ua.match(/Android (\d+)/i)?.[1]}`;
  } else if (/Linux/i.test(ua)) os = "Linux";

  return { deviceType, browser, os };
}

function extractIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  if (Array.isArray(forwarded)) return forwarded[0];
  return req.ip ?? "unknown";
}

describe("parseUserAgent", () => {
  it("returns unknown for undefined UA", () => {
    assert.deepEqual(parseUserAgent(undefined), {
      deviceType: "unknown",
      browser: "unknown",
      os: "unknown",
    });
  });

  it("detects iPhone mobile + Safari", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    const r = parseUserAgent(ua);
    assert.equal(r.deviceType, "mobile");
    assert.ok(r.browser.startsWith("Safari"));
    assert.ok(r.os.startsWith("iOS"));
  });

  it("detects desktop Chrome (Edge not misclassified)", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    const r = parseUserAgent(ua);
    assert.equal(r.deviceType, "desktop");
    assert.ok(r.browser.startsWith("Chrome"));
    assert.ok(r.os.includes("Windows"));
  });

  it("detects Edge via Edg/", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    const r = parseUserAgent(ua);
    assert.ok(r.browser.startsWith("Edge"));
  });
});

describe("extractIp", () => {
  it("uses first X-Forwarded-For entry", () => {
    const req = {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      ip: "9.9.9.9",
    } as Request;
    assert.equal(extractIp(req), "1.2.3.4");
  });

  it("handles X-Forwarded-For as array", () => {
    const req = {
      headers: { "x-forwarded-for": ["1.2.3.4", "5.6.7.8"] },
      ip: "10.0.0.1",
    } as unknown as Request;
    assert.equal(extractIp(req), "1.2.3.4");
  });

  it("falls back to req.ip", () => {
    const req = { headers: {}, ip: "10.0.0.2" } as Request;
    assert.equal(extractIp(req), "10.0.0.2");
  });

  it("returns unknown when no forwarded and no ip", () => {
    const req = { headers: {} } as Request;
    assert.equal(extractIp(req), "unknown");
  });
});
