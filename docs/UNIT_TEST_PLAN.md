# Unit Test Plan — b2c-backend

## Overview

This document captures the full unit test analysis for the b2c-backend repo. It covers:
- The testing stack and conventions already in use
- All existing test coverage
- Every missing test file and the specific cases each should contain
- Gaps in existing test files
- What is intentionally out of scope for unit tests

---

## Testing Stack

| Concern | Tool |
|---------|------|
| Test runner | Node.js built-in `node:test` |
| Assertions | `node:assert/strict` |
| TypeScript execution | `tsx --test` |
| Test organisation | `describe` / `it` blocks (see `jwt.test.ts`) or top-level `test()` calls (see `budgetUtils.test.ts`) — both styles are used |

**Key convention:** Tests that would require loading modules with environment-variable dependencies (e.g. Appwrite SDK) inline the pure function under test rather than importing it from the source file. See `server/auth/jwt.test.ts` for the canonical example.

**npm scripts (existing):**
```
npm test                 # runs all *.test.ts files
npm run test:grocery     # groceryList.test.ts
npm run test:budget      # budgetUtils.test.ts
npm run test:nutrition   # memberScope + nutritionDashboardUtils
```

---

## Repo Architecture Summary

### Tech Stack

- **Framework:** Express.js + TypeScript
- **Database:** PostgreSQL via Drizzle ORM (`postgres.js` driver)
- **Authentication:** Appwrite (JWT in `X-Appwrite-JWT` header)
- **Validation:** Zod (request bodies + env vars)
- **External services:** Supabase (profile sync), OpenAI (chat/meal planning), FastAPI RAG backend (search/recommendations/scanning)
- **Security:** Helmet, CORS origin whitelist, per-user in-memory rate limiting, idempotency deduplication

### Directory Structure

```
server/
├── index.ts                   # Entry point, graceful shutdown
├── app.ts                     # Express setup, global middleware, CORS, helmet
├── routes.ts                  # Central route registration
├── scheduler.ts               # Cron jobs (notifications)
├── auth/
│   ├── jwt.ts                 # extractJWTFromHeaders, verifyAppwriteJWT
│   ├── jwt.test.ts            # (EXISTS)
│   └── admin.ts               # handleAdminImpersonation, requireAdmin
├── middleware/
│   ├── auth.ts                # Primary auth: JWT verify, auto-provision, RLS context
│   ├── errorHandler.ts        # AppError class + RFC 7807 Problem Details handler
│   ├── householdPermission.ts # requireHouseholdRole, requireProfileEditAccess
│   ├── idempotency.ts         # Idempotency-Key dedup (in-memory, 15 min TTL)
│   ├── rateLimit.ts           # Per-user rate limiting (read/write buckets, in-memory)
│   └── audit.ts               # Audit log entries
├── config/
│   ├── database.ts            # Drizzle ORM, RLS via SET app.current_user_id
│   ├── env.ts                 # Zod env validation schema
│   ├── appwrite.ts            # Appwrite client + JWT verification
│   └── supabase.ts            # Supabase client
├── routes/                    # 28 route files (see route inventory below)
├── services/                  # Business logic + data access (44 files)
└── shared/goldSchema.js       # Drizzle schema definitions
```

### Route Inventory

| Route file | Prefix | Key endpoints |
|------------|--------|---------------|
| `admin.ts` | `/api/v1/admin` | GET /dashboard, POST /recipes, PUT /recipes/:id |
| `analyzer.ts` | `/api/v1/analyzer` | POST /analyze-image, /analyze-text, /detect-nutrition |
| `budget.ts` | `/api/v1/budget` | GET /, POST /, GET /:id |
| `chat.ts` | `/api/v1/chat` | POST /, GET /history |
| `feed.ts` | `/api/v1/feed` | GET /, GET /recommendations |
| `groceryList.ts` | `/api/v1/grocery-lists` | POST /, GET /:id, GET /:id/items, PUT /:id/items/:itemId |
| `groceryPreferences.ts` | `/api/v1/grocery-preferences` | GET /, GET /:id, PUT /:id |
| `health.ts` | `/` | GET /healthz, GET /readyz |
| `household.ts` | `/api/v1/households` | GET/POST/PATCH/DELETE /members |
| `householdInvite.ts` | `/api/v1/households/invitations` | POST /, GET /, DELETE /:id, GET /accept/:token |
| `householdPreference.ts` | `/api/v1/households/preferences` | GET /, POST /, DELETE /:id |
| `ingredientSearch.ts` | `/api/v1/ingredients` | GET /search |
| `mealLog.ts` | `/api/v1/meal-log` | GET /, POST /, PUT /:id, GET /:id, DELETE /:id |
| `mealPlan.ts` | `/api/v1/meal-plans` | POST /, GET /:id, GET /:id/nutrition |
| `notifications.ts` | `/api/v1/notifications` | GET /, GET /:id, PATCH /:id |
| `nps.ts` | `/api/v1/nps` | GET /eligible, POST /, POST /dismiss |
| `nutritionDashboard.ts` | `/api/v1/nutrition-dashboard` | GET /, GET /trends, GET /snapshot |
| `recipeMeta.ts` | `/api/v1/recipe-meta` | GET /, POST /detect-allergens |
| `recipes.ts` | `/api/v1/recipes` | GET /, GET /popular, GET /:id, POST /:id/save, POST /:id/rate |
| `scan.ts` | `/api/v1/scan` | POST /barcode, POST /ocr, GET /:id |
| `substitutions.ts` | `/api/v1/substitutions` | GET /, GET /:id |
| `sync.ts` | `/api/v1/sync` | POST /profile, POST /health |
| `taxonomy.ts` | `/api/v1/taxonomy` | GET /allergens, /health-conditions, /dietary-preferences |
| `uploads.ts` | `/api/v1/uploads` | POST /, DELETE /:id |
| `user.ts` | `/api/v1/me` | GET/PATCH/DELETE /profile, GET /saved-recipes, /recipe-history, /most-cooked |
| `userRecipes.ts` | `/api/v1/user-recipes` | GET /, GET /:id, POST /, PUT /:id, DELETE /:id, POST /:id/share, POST /:id/submit-review |

### Authentication & Authorization Flow

```
Request
  └─ extractJWTFromHeaders()         jwt.ts
  └─ verifyAppwriteJWT()             appwrite.ts  (calls Appwrite SDK)
  └─ handleAdminImpersonation()      admin.ts     (GET-only, audit-logged)
  └─ getB2cCustomerByAppwriteId()    b2cIdentity.ts
  └─ auto-provision if missing        supabaseSync.ts
  └─ setCurrentUser()                database.ts  (PostgreSQL GUC for RLS)
  └─ maybeLogLogin()                 sessionTracking.ts  (30-min debounce)
  └─ req.user = { userId, isAdmin, b2cCustomerId, householdRole, householdId }
```

**RBAC roles:** `primary_adult`, `secondary_adult`, `child`, `dependent`

**Admin impersonation:** `X-Act-As-User` header; GET requests only; always audit-logged.

---

## Existing Test Coverage

| File | Functions tested | Cases |
|------|-----------------|-------|
| `server/auth/jwt.test.ts` | `extractJWTFromHeaders` | 6 |
| `server/services/budgetUtils.test.ts` | `getCurrentBudgetWindow`, `getRecentBudgetWindows`, `buildRuleBasedRecommendations`, `mergeRecommendations` | 4 |
| `server/services/groceryListUtils.test.ts` | `aggregateIngredients`, `chooseCheapestUsd`, `estimateBucketPrice` | — |
| `server/services/groceryList.test.ts` | `canTransitionGroceryListStatus` | — |
| `server/services/contextBuilder.test.ts` | `buildRecommendationContext` | — |
| `server/services/foodPyramidValidator.test.ts` | `auditMealPlanAgainstGuidelines` | — |
| `server/services/memberScope.test.ts` | `resolveMemberScope` | — |
| `server/services/nutritionDashboardUtils.test.ts` | `calculateNutritionMetrics`, `computeTrends` | — |

---

## Missing Test Files

### 1. `server/auth/admin.test.ts`

**Source file:** `server/auth/admin.ts`
**Functions under test:** `handleAdminImpersonation`, `requireAdmin`
**Dependencies to mock:** `auditImpersonation` from `server/services/admin.ts`

| # | Case | Expected |
|---|------|----------|
| 1 | Non-admin user, GET, `X-Act-As-User` header present | `isImpersonating = false`, `effectiveUserId = own userId` |
| 2 | Admin user, POST request, `X-Act-As-User` present | No impersonation (GET-only guard); `isImpersonating = false` |
| 3 | Admin user, GET, no `X-Act-As-User` header | `isImpersonating = false`, `effectiveUserId = own userId` |
| 4 | Admin user, GET, `X-Act-As-User` present | `isImpersonating = true`, `effectiveUserId = target user ID` |
| 5 | Admin impersonation | `auditImpersonation` called with actor, target, url, ip, user-agent |
| 6 | All original `userContext` fields preserved in returned `AdminContext` | Spread check on returned object |
| 7 | `requireAdmin` called with non-admin user | Throws `Error("Admin access required")` |
| 8 | `requireAdmin` called with admin user | Does not throw |

---

### 2. `server/middleware/errorHandler.test.ts`

**Source file:** `server/middleware/errorHandler.ts`
**Functions under test:** `AppError` class, `errorHandler`, `notFoundHandler`
**Dependencies:** None — mock Express `req`/`res`/`next` objects

| # | Case | Expected |
|---|------|----------|
| 1 | `AppError` constructor | Sets `status`, `title`, `detail`, `type`, `extra`; `name === 'AppError'` |
| 2 | `AppError` with no `type` argument | `type` defaults to `'about:blank'` |
| 3 | `errorHandler` with `AppError` | RFC 7807 body with correct `status`, `title`, `detail`, `type`, `instance = req.url` |
| 4 | `errorHandler` with `AppError` that has `extra` fields | Extra fields merged into response body |
| 5 | `errorHandler` with `err.name === 'ValidationError'` | Status 400, `type` = validation URL, `errors` field present |
| 6 | `errorHandler` with `err.validation` set (no `.name`) | Status 400, `errors = err.validation` |
| 7 | `errorHandler` with PostgreSQL `err.code === '23505'` | Status 409, title "Duplicate Resource" |
| 8 | `errorHandler` with PostgreSQL `err.code === '23503'` | Status 400, title "Reference Error" |
| 9 | `errorHandler` with PostgreSQL `err.code === '42703'` | Status 503, title "Database Schema Out of Date", `migration` field present |
| 10 | `errorHandler` with `err.status = 404` | Status 404, title "Not Found" |
| 11 | `errorHandler` with `err.status = 422` | Status 422, title "Unprocessable Entity" |
| 12 | `errorHandler` with `err.statusCode = 400` (not `.status`) | Uses `statusCode`, status 400 |
| 13 | `errorHandler` with unknown error (no code, no status) | Status 500, title "Internal Server Error" |
| 14 | `errorHandler` when `res.headersSent === true` | Calls `next(err)`, does not write response |
| 15 | `notFoundHandler` | Status 404, `detail` includes `req.path` |

---

### 3. `server/middleware/householdPermission.test.ts`

**Source file:** `server/middleware/householdPermission.ts`
**Functions under test:** `requireHouseholdRole`, `requireProfileEditAccess`
**Dependencies:** None — mock `req`/`res`/`next`

#### `requireHouseholdRole`

| # | Case | Expected |
|---|------|----------|
| 1 | `req.user` is `undefined` | `next(AppError)` with status 403, "No household role found" |
| 2 | `req.user.householdRole` is `undefined` | `next(AppError)` with status 403 |
| 3 | Role `child` when only `primary_adult` allowed | `next(AppError)` 403 with detail listing allowed roles and actual role |
| 4 | Role matches the single allowed role | `next()` called with no argument |
| 5 | Role matches one of multiple allowed roles (e.g. `secondary_adult` in `["primary_adult", "secondary_adult"]`) | `next()` called |

#### `requireProfileEditAccess`

| # | Case | Expected |
|---|------|----------|
| 6 | `req.user.b2cCustomerId === req.params.id` | `next()` called (owner edits own profile) |
| 7 | `req.user.householdRole === 'primary_adult'`, editing different member | `next()` called |
| 8 | `secondary_adult` editing a different member | `next(AppError)` 403 |
| 9 | `child` role editing | `next(AppError)` 403 |
| 10 | `req.params.id` absent, `req.params.memberId` set and matches owner | `next()` called (fallback param) |

---

### 4. `server/middleware/rateLimit.test.ts`

**Source file:** `server/middleware/rateLimit.ts`
**Functions under test:** `rateLimitMiddleware`, `evictIfNeeded` (private — test via observable side effects), `startRateLimitCleanup`, `stopRateLimitCleanup`
**Dependencies:** `env` (mock read/write RPM values); no DB

> Note: The in-memory `rateLimitStore` must be cleared between tests. Either export a `clearRateLimitStore()` helper or reset it via module re-import.

| # | Case | Expected |
|---|------|----------|
| 1 | `req.user` is undefined | `next()` called immediately; no store mutation |
| 2 | GET request | Uses `read` bucket (`userId:read`) |
| 3 | POST request | Uses `write` bucket (`userId:write`) |
| 4 | PUT request | Uses `write` bucket |
| 5 | PATCH request | Uses `write` bucket |
| 6 | DELETE request | Uses `write` bucket |
| 7 | First request, count = 1, limit = 60 | `RateLimit` header = 59; `next()` called |
| 8 | Count reaches limit exactly | `next()` called (limit is `> limit`, not `>= limit`) |
| 9 | Count exceeds limit (count = limit + 1) | Status 429, Problem Details body |
| 10 | Window expiry resets counter | After `resetTime` passes, counter resets and request succeeds |
| 11 | Read and write buckets are independent for the same user | Exhausting write bucket does not affect read bucket |
| 12 | `stopRateLimitCleanup` then `startRateLimitCleanup` does not create duplicate timers | Only one interval registered |

---

### 5. `server/middleware/idempotency.test.ts`

**Source file:** `server/middleware/idempotency.ts`
**Functions under test:** `idempotencyMiddleware`, `storeIdempotentResponse`
**Dependencies:** None — mock `req`/`res`/`next`; control `Date.now()` for TTL tests

> Note: The in-memory `store` must be cleared between tests. Export a `clearIdempotencyStore()` helper or rely on module re-import.

#### `idempotencyMiddleware`

| # | Case | Expected |
|---|------|----------|
| 1 | No `Idempotency-Key` header | Skips entirely; `next()` called; `res.locals.idempotencyKey` not set |
| 2 | New key, valid body | Record stored; `res.locals.idempotencyKey` set; `next()` called |
| 3 | Same key, same method, path, body — response not yet stored (in-flight) | `next()` called (not a replay yet) |
| 4 | Same key, same method, path, body — response already stored | Replays stored `responseStatus` and `responseBody` |
| 5 | Same key, different HTTP method | Status 409, "different method or path" |
| 6 | Same key, different path | Status 409, "different method or path" |
| 7 | Same key, same method + path, different body | Status 409, "different request body" |
| 8 | Expired record (`expiresAt` in the past) | Treated as new request; `next()` called |
| 9 | Store exceeds 5 000 entries | Oldest 20% evicted (evictIfNeeded) |

#### `storeIdempotentResponse`

| # | Case | Expected |
|---|------|----------|
| 10 | POST with idempotency key, response sent | `responseStatus` and `responseBody` stored in record; TTL refreshed |
| 11 | GET with idempotency key, response sent | Response NOT stored (only POST/PUT/PATCH) |
| 12 | No `res.locals.idempotencyKey` | Original `res.json` behaviour unchanged |

---

### 6. `server/services/sessionTracking.test.ts`

**Source file:** `server/services/sessionTracking.ts`
**Functions under test:** `parseUserAgent` and `extractIp` (currently unexported)

> Convention: inline both functions in the test file to avoid importing the module (which requires DB env vars), following the same pattern as `jwt.test.ts`.

#### `parseUserAgent`

| # | Input UA string | Expected output |
|---|-----------------|-----------------|
| 1 | `undefined` | `{ deviceType: "unknown", browser: "unknown", os: "unknown" }` |
| 2 | iPhone UA | `deviceType: "mobile"` |
| 3 | Android Mobile UA | `deviceType: "mobile"` |
| 4 | iPad UA | `deviceType: "tablet"` |
| 5 | Android without "Mobile" (tablet) | `deviceType: "tablet"` |
| 6 | Desktop Chrome UA | `deviceType: "desktop"` |
| 7 | Chrome UA | `browser: "Chrome <version>"` |
| 8 | Firefox UA | `browser: "Firefox <version>"` |
| 9 | Safari UA (not Chrome) | `browser: "Safari <version>"` |
| 10 | Edge UA (`Edg/`) | `browser: "Edge <version>"` — not Chrome despite Chrome substring |
| 11 | Opera UA (`OPR/`) | `browser: "Opera <version>"` — not Chrome despite Chrome substring |
| 12 | Windows 10 UA | `os: "Windows 10/11"` |
| 13 | Windows NT (not 10) | `os: "Windows"` |
| 14 | macOS UA with `_` separators | `os: "macOS <version>"` with underscores replaced by dots |
| 15 | iPhone OS UA | `os: "iOS <major>"` |
| 16 | iPad OS UA | `os: "iPadOS <major>"` |
| 17 | Android UA | `os: "Android <major>"` |
| 18 | Linux UA | `os: "Linux"` |

#### `extractIp`

| # | Case | Expected |
|---|------|----------|
| 19 | `X-Forwarded-For: "1.2.3.4, 5.6.7.8"` | `"1.2.3.4"` (first entry, trimmed) |
| 20 | `X-Forwarded-For` as array `["1.2.3.4", "5.6.7.8"]` | `"1.2.3.4"` |
| 21 | No `X-Forwarded-For` header | Falls back to `req.ip` |
| 22 | No `X-Forwarded-For` and `req.ip === undefined` | Returns `"unknown"` |

---

## Gaps in Existing Test Files

### `server/services/budgetUtils.test.ts`

| # | Missing case |
|---|-------------|
| 1 | `getCurrentBudgetWindow` with `monthly` at February in a leap year (28 vs 29 days) |
| 2 | `getCurrentBudgetWindow` during a DST transition hour |
| 3 | `buildRuleBasedRecommendations` when all inputs are under threshold → empty tips array |
| 4 | `buildRuleBasedRecommendations` with `unpricedPurchasedItems = 0` → no `missing-actual-prices` tip |
| 5 | `mergeRecommendations` when both input arrays are empty → `[]` |
| 6 | `mergeRecommendations` when only one list has entries → that list returned as-is |

### `server/services/groceryListUtils.test.ts`

| # | Missing case |
|---|-------------|
| 1 | `aggregateIngredients` with unrecognisable or null units → graceful fallback (no crash) |
| 2 | `chooseCheapestUsd` with an empty candidate array |
| 3 | `estimateBucketPrice` when `packageWeightG` is `null` or `0` → handles gracefully |

---

## Out of Scope for Unit Tests

The following require live database, Appwrite SDK, or external HTTP calls and belong in **integration tests**:

| Area | Reason |
|------|--------|
| `server/middleware/auth.ts` | Calls Appwrite SDK + DB auto-provisioning |
| All `server/services/*.ts` that call `executeRaw` / Drizzle | Live DB required |
| `server/config/appwrite.ts` | Requires Appwrite credentials |
| `server/services/ragClient.ts` | External HTTP to FastAPI |
| `server/services/llm.ts` / `chatbot.ts` / `mealPlanLLM.ts` | OpenAI SDK |
| `server/scheduler.ts` | Cron + DB side effects |
| `server/services/supabaseSync.ts` | Supabase SDK |
| Full route-level tests | Require full Express stack + auth |

---

## Test Count Summary

| File | Status | Estimated cases |
|------|--------|----------------|
| `server/auth/jwt.test.ts` | Exists | 6 |
| `server/auth/admin.test.ts` | **Missing** | 8 |
| `server/middleware/errorHandler.test.ts` | **Missing** | 15 |
| `server/middleware/householdPermission.test.ts` | **Missing** | 10 |
| `server/middleware/rateLimit.test.ts` | **Missing** | 12 |
| `server/middleware/idempotency.test.ts` | **Missing** | 12 |
| `server/services/sessionTracking.test.ts` | **Missing** | 22 |
| `server/services/budgetUtils.test.ts` | Exists — gaps | +6 |
| `server/services/groceryListUtils.test.ts` | Exists — gaps | +3 |
| `server/services/groceryList.test.ts` | Exists | — |
| `server/services/contextBuilder.test.ts` | Exists | — |
| `server/services/foodPyramidValidator.test.ts` | Exists | — |
| `server/services/memberScope.test.ts` | Exists | — |
| `server/services/nutritionDashboardUtils.test.ts` | Exists | — |

**New test cases to write: ~88** across 5 new files + gap coverage in 2 existing files.
