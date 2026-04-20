// Deprecated shim.
// Use server/lib/auth.ts as the single source of truth.

export { requireAuth, extractJWT as extractJwt } from "../lib/auth.js";

/** @deprecated Alias for requireAuth — used by route files that import { authMiddleware } */
export { requireAuth as authMiddleware } from "../lib/auth.js";