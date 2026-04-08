/**
 * server/services/sessionTracking.ts — B2C-020: Session Event Tracking
 *
 * Fire-and-forget session event logging with 30-minute debounce.
 * Parses User-Agent for device/browser/OS via lightweight regex.
 *
 * Usage in auth middleware:
 *   maybeLogLogin(req, customerId).catch(() => {});
 */

import type { Request } from "express";
import { executeRaw } from "../config/database.js";
import { logger } from "../config/logger.js";

// ── User-Agent Parsing (lightweight, no external dep) ──────────────────────

interface UAInfo {
  deviceType: string;
  browser: string;
  os: string;
}

function parseUserAgent(ua: string | undefined): UAInfo {
  if (!ua) return { deviceType: "unknown", browser: "unknown", os: "unknown" };

  // Device type
  let deviceType = "desktop";
  if (/Mobi|Android.*Mobile|iPhone|iPod/i.test(ua)) deviceType = "mobile";
  else if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) deviceType = "tablet";

  // Browser (order matters — check specific first)
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

  // OS
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

// ── IP Extraction ──────────────────────────────────────────────────────────

function extractIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  if (Array.isArray(forwarded)) return forwarded[0];
  return req.ip ?? "unknown";
}

// ── Session Event Logging ──────────────────────────────────────────────────

const DEBOUNCE_MINUTES = 30;

/**
 * Fire-and-forget: log a "login" session event if no event exists for this
 * customer in the last DEBOUNCE_MINUTES. This approximates session starts
 * without requiring complex session tracking.
 *
 * MUST be called as: maybeLogLogin(req, id).catch(() => {})
 */
export async function maybeLogLogin(
  req: Request,
  b2cCustomerId: string | undefined
): Promise<void> {
  if (!b2cCustomerId) return;

  try {
    // Debounce: check if a login event exists in the last 30 minutes
    const recent = await executeRaw(
      `SELECT 1 FROM gold.b2c_session_events
       WHERE b2c_customer_id = $1
         AND event_type = 'login'
         AND created_at > now() - make_interval(mins => $2)
       LIMIT 1`,
      [b2cCustomerId, DEBOUNCE_MINUTES]
    );

    if (recent && (recent as any[]).length > 0) return; // Already logged recently

    const rawUa = req.headers["user-agent"] as string | undefined;
    const { deviceType, browser, os } = parseUserAgent(rawUa);
    const ip = extractIp(req);

    await executeRaw(
      `INSERT INTO gold.b2c_session_events
         (b2c_customer_id, event_type, device_type, browser, os, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [b2cCustomerId, "login", deviceType, browser, os, ip, rawUa ?? null]
    );
  } catch (err) {
    // Silently log — never block the user request
    logger.error("[SESSION-TRACK]", (err as Error).message);
  }
}

/**
 * Log a "logout" session event. Called from the logout route.
 * Unlike maybeLogLogin, no debounce is needed — logout is an explicit user action.
 */
export async function logLogout(
  req: Request,
  b2cCustomerId: string | undefined
): Promise<void> {
  if (!b2cCustomerId) return;

  try {
    const rawUa = req.headers["user-agent"] as string | undefined;
    const { deviceType, browser, os } = parseUserAgent(rawUa);
    const ip = extractIp(req);

    await executeRaw(
      `INSERT INTO gold.b2c_session_events
         (b2c_customer_id, event_type, device_type, browser, os, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [b2cCustomerId, "logout", deviceType, browser, os, ip, rawUa ?? null]
    );
  } catch (err) {
    logger.error("[SESSION-TRACK] logout", (err as Error).message);
  }
}
