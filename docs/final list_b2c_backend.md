# Final Unit Test List - b2c-backend-clean

This document is the consolidated final list of unit tests to include for `b2c-backend-clean`, based on:
- current repository test coverage
- gaps found during code review
- comparison with `docs/UNIT_TEST_PLAN.md`

No production code changes are included in this scope.

---

## P0 - Must Add First

### New test files
- `server/auth/admin.test.ts`
  - `handleAdminImpersonation`: non-admin deny, GET-only guard, no-header path, impersonation success, audit call payload.
  - `requireAdmin`: throws for non-admin, passes for admin.

- `server/middleware/errorHandler.test.ts`
  - `AppError` constructor defaults and fields.
  - `errorHandler` RFC7807 response mapping for:
    - `AppError`
    - validation errors
    - PG codes (`23505`, `23503`, `42703`)
    - explicit status/statusCode
    - unknown error -> 500
    - `res.headersSent` passthrough to `next`.
  - `notFoundHandler` 404 shape.

- `server/middleware/householdPermission.test.ts`
  - `requireHouseholdRole`: missing user/role, mismatch, single and multi-role allow.
  - `requireProfileEditAccess`: self edit allow, primary adult allow, secondary/child deny, `memberId` fallback.

- `server/middleware/rateLimit.test.ts`
  - no-user bypass.
  - read vs write bucket selection by HTTP method.
  - limit edge (`== limit` allow, `> limit` reject 429).
  - window reset behavior.
  - independent read/write counters.
  - cleanup start/stop behavior (no duplicate intervals).

- `server/middleware/idempotency.test.ts`
  - no key bypass.
  - new key storage + `res.locals.idempotencyKey`.
  - replay behavior (same method/path/body).
  - conflict behavior (different method/path/body).
  - expired key handling.
  - store eviction threshold behavior.
  - `storeIdempotentResponse` for allowed methods only.

- `server/services/sessionTracking.test.ts`
  - `parseUserAgent` matrix: device/browser/OS detection boundaries.
  - `extractIp` precedence: `X-Forwarded-For`, array form, fallback to `req.ip`, unknown.

---

## P1 - Expand Existing Tests

- `server/services/budgetUtils.test.ts`
  - add coverage for `normalizeTimeZone`, `getUtilizationPct`.
  - add on-track/no-risk recommendation case.
  - add `mergeRecommendations` empty/single-list behavior.
  - add calendar boundary robustness (including leap-year handling).

- `server/services/nutritionDashboardUtils.test.ts`
  - `convertUnit` matrix and unknown-unit passthrough.
  - `computeWeightGoalProgress` gain/loss/clamp/null paths.
  - boundary checks for threshold-based status outcomes.

- `server/services/memberScope.test.ts` (or add dedicated `memberScopeUtils` cases)
  - actor missing.
  - actor household missing.
  - requested target member missing.
  - validation of household-member resolution behavior.

- `server/services/foodPyramidValidator.test.ts`
  - dietary conflict / skipped-group behavior in guideline audit output.
  - warning formatting edge cases.

- `server/services/contextBuilder.test.ts`
  - deterministic meal-slot boundary tests (time cutoffs).
  - season/hemisphere boundary checks.

---

## P2 - Recommended Additions

- `server/services/ragClient.test.ts`
  - `toRagScope` mapping.
  - feature-gate behavior.
  - circuit breaker transition behavior.

- `server/middleware/audit.test.ts`
  - wrapper invocation and error propagation to `next`.
  - payload/metadata forwarding behavior.

---

## Existing Tests To Retain

- `server/auth/jwt.test.ts`
- `server/services/budgetUtils.test.ts`
- `server/services/groceryListUtils.test.ts`
- `server/services/groceryList.test.ts`
- `server/services/contextBuilder.test.ts`
- `server/services/foodPyramidValidator.test.ts`
- `server/services/memberScope.test.ts`
- `server/services/nutritionDashboardUtils.test.ts`

---

## Notes

- This is a unit-test-only backlog and does not include integration/E2E scope.
- Current default `npm test` script selection should be reviewed separately to ensure all intended test files are executed in CI.
