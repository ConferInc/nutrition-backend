import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRuleBasedRecommendations,
  getCurrentBudgetWindow,
  getRecentBudgetWindows,
  getUtilizationPct,
  mergeRecommendations,
  normalizeTimeZone,
} from "./budgetUtils.js";

test("getCurrentBudgetWindow computes weekly boundaries using timezone calendar", () => {
  const now = new Date("2026-02-20T12:00:00.000Z");
  const window = getCurrentBudgetWindow("weekly", "America/New_York", now);

  assert.equal(window.startDateLocal, "2026-02-16");
  assert.equal(window.endDateLocal, "2026-02-22");
  assert.ok(window.startUtc < window.endUtc);
});

test("getCurrentBudgetWindow computes monthly boundaries using timezone calendar", () => {
  const now = new Date("2026-02-20T12:00:00.000Z");
  const window = getCurrentBudgetWindow("monthly", "America/New_York", now);

  assert.equal(window.startDateLocal, "2026-02-01");
  assert.equal(window.endDateLocal, "2026-02-28");
  assert.ok(window.startUtc < window.endUtc);
});

test("getRecentBudgetWindows returns ordered windows", () => {
  const now = new Date("2026-02-20T12:00:00.000Z");
  const windows = getRecentBudgetWindows("weekly", "UTC", 3, now);

  assert.equal(windows.length, 3);
  assert.equal(windows[0]?.startDateLocal, "2026-02-02");
  assert.equal(windows[1]?.startDateLocal, "2026-02-09");
  assert.equal(windows[2]?.startDateLocal, "2026-02-16");
});

test("buildRuleBasedRecommendations includes over-budget and slippage signals", () => {
  const tips = buildRuleBasedRecommendations({
    period: "weekly",
    spent: 250,
    budgetAmount: 200,
    breakdown: [
      { category: "Protein", amount: 130 },
      { category: "Produce", amount: 60 },
    ],
    planVsActual: {
      estimated: 180,
      actual: 250,
    },
    unpricedPurchasedItems: 2,
    substitutionOpportunityCount: 3,
    substitutionPotentialSavings: 12.5,
  });

  assert.ok(tips.some((t) => t.id === "budget-overrun"));
  assert.ok(tips.some((t) => t.id === "plan-actual-slippage"));
  assert.ok(tips.some((t) => t.id === "missing-actual-prices"));
  assert.ok(tips.some((t) => t.id === "substitution-opportunities"));
});

test("normalizeTimeZone returns UTC for blank or invalid", () => {
  assert.equal(normalizeTimeZone(""), "UTC");
  assert.equal(normalizeTimeZone("   "), "UTC");
  assert.equal(normalizeTimeZone("Not/A_Real_Zone_12345"), "UTC");
});

test("normalizeTimeZone preserves valid IANA zones", () => {
  assert.equal(normalizeTimeZone("America/New_York"), "America/New_York");
});

test("getUtilizationPct returns null for invalid budget and rounds otherwise", () => {
  assert.equal(getUtilizationPct(50, null), null);
  assert.equal(getUtilizationPct(50, 0), null);
  assert.equal(getUtilizationPct(25, 100), 25);
});

test("buildRuleBasedRecommendations returns on-track when no risk signals", () => {
  const tips = buildRuleBasedRecommendations({
    period: "weekly",
    spent: 100,
    budgetAmount: 200,
    breakdown: [
      { category: "produce", amount: 25 },
      { category: "dairy", amount: 25 },
      { category: "meat", amount: 25 },
      { category: "snacks", amount: 25 },
    ],
    planVsActual: null,
    unpricedPurchasedItems: 0,
    substitutionOpportunityCount: 0,
    substitutionPotentialSavings: 0,
  });
  assert.ok(tips.some((t) => t.id === "on-track"));
});

test("getCurrentBudgetWindow monthly in leap year February", () => {
  const now = new Date("2024-02-15T12:00:00.000Z");
  const window = getCurrentBudgetWindow("monthly", "UTC", now);
  assert.equal(window.endDateLocal, "2024-02-29");
});

test("mergeRecommendations returns rules-only when llm list empty", () => {
  const rules = [
    {
      id: "r1",
      title: "A",
      description: "d",
      severity: "info" as const,
      potentialSavings: null,
      source: "rules" as const,
    },
  ];
  assert.deepEqual(mergeRecommendations(rules, []), rules);
  assert.deepEqual(mergeRecommendations(rules, null), rules);
});

test("mergeRecommendations de-duplicates repeated advice", () => {
  const merged = mergeRecommendations(
    [
      {
        id: "r1",
        title: "Tip A",
        description: "Save here",
        severity: "info",
        potentialSavings: null,
        source: "rules",
      },
    ],
    [
      {
        id: "l1",
        title: "Tip A",
        description: "Save here",
        severity: "warning",
        potentialSavings: 4,
        source: "llm",
      },
    ]
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.source, "llm");
});
