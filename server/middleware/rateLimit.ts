import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";

// In-memory rate limiting store
// NOTE: For multi-instance deployments, replace with Redis-based limiter.
// PERF-01: Capped at 10K entries to prevent unbounded memory growth.
const MAX_STORE_SIZE = 10_000;
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

/** Clears in-memory buckets — for unit tests only. */
export function clearRateLimitStoreForTests(): void {
  rateLimitStore.clear();
}

/** Evict oldest 20% of entries when Map exceeds cap */
function evictIfNeeded() {
  if (rateLimitStore.size <= MAX_STORE_SIZE) return;
  const toDelete = Math.floor(rateLimitStore.size * 0.2);
  let deleted = 0;
  for (const key of rateLimitStore.keys()) {
    if (deleted >= toDelete) break;
    rateLimitStore.delete(key);
    deleted++;
  }
}

// Cleanup timer reference for proper shutdown
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return next(); // Skip rate limiting for unauthenticated requests
  }

  const userId = req.user.userId;
  const isHeavyWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const limit = isHeavyWrite ? env.RATE_LIMITS_WRITE_RPM : env.RATE_LIMITS_READ_RPM;
  const windowMs = 60 * 1000; // 1 minute window

  const bucket = `${userId}:${isHeavyWrite ? 'write' : 'read'}`;
  const now = Date.now();

  // Get current bucket state
  let bucketState = rateLimitStore.get(bucket);

  // Reset if window has passed
  if (!bucketState || bucketState.resetTime <= now) {
    bucketState = {
      count: 0,
      resetTime: now + windowMs
    };
  }

  // Increment counter
  bucketState.count++;
  rateLimitStore.set(bucket, bucketState);
  evictIfNeeded(); // PERF-01: enforce size cap

  // Calculate remaining requests
  const remaining = Math.max(0, limit - bucketState.count);
  const resetTime = new Date(bucketState.resetTime);

  // Set rate limit headers
  res.setHeader('RateLimit', remaining.toString());
  res.setHeader('RateLimit-Policy', `${limit};w=60`);
  res.setHeader('RateLimit-Reset', resetTime.toISOString());

  // Check if limit exceeded
  if (bucketState.count > limit) {
    return res.status(429).json({
      type: 'about:blank',
      title: 'Too Many Requests',
      status: 429,
      detail: `Rate limit exceeded. ${limit} requests per minute allowed.`,
      instance: req.url
    });
  }

  next();
}

// Start cleanup interval (called once at startup; .unref() so it won't keep
// the process alive and block graceful shutdown)
export function startRateLimitCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of rateLimitStore) {
      if (bucket.resetTime <= now) {
        rateLimitStore.delete(key);
      }
    }
  }, 5 * 60 * 1000); // Cleanup every 5 minutes
  cleanupTimer.unref(); // Don't block process exit
}

// Stop cleanup (for tests or graceful shutdown)
export function stopRateLimitCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// Auto-start cleanup on module load
startRateLimitCleanup();
