import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateNutrientGaps,
  computeBmr,
  computeTdee,
  computeWeightGoalProgress,
  convertUnit,
  dedupeSnapshotRows,
} from "./nutritionDashboardUtils.js";

test("calculateNutrientGaps sorts by percent and converts units", () => {
  const gaps = calculateNutrientGaps([
    {
      key: "sodium",
      label: "Sodium",
      intake: 2,
      intakeUnit: "g",
      target: 2300,
      targetUnit: "mg",
    },
    {
      key: "protein",
      label: "Protein",
      intake: 25,
      intakeUnit: "g",
      target: 50,
      targetUnit: "g",
    },
  ]);

  assert.equal(gaps.length, 2);
  assert.equal(gaps[0]?.key, "protein");
  assert.equal(gaps[0]?.percentOfTarget, 50);
  assert.equal(gaps[1]?.key, "sodium");
  assert.equal(gaps[1]?.percentOfTarget, 86.96);
});

test("computeBmr and computeTdee produce fallback values", () => {
  const bmr = computeBmr(70, 175, 30, "male");
  assert.equal(bmr, 1648.75);

  const tdee = computeTdee(bmr, "moderately_active");
  assert.equal(tdee, 2555.56);
});

test("convertUnit mg g mcg round-trip", () => {
  assert.equal(convertUnit(1, "g", "mg"), 1000);
  assert.equal(convertUnit(1000, "mg", "g"), 1);
  assert.equal(convertUnit(1000, "mcg", "mg"), 1);
  assert.equal(convertUnit(2, "mg", "mg"), 2);
});

test("convertUnit returns value unchanged for unknown units", () => {
  assert.equal(convertUnit(5, "iu", "mg"), 5);
});

test("computeWeightGoalProgress clamps to 0-100", () => {
  assert.equal(computeWeightGoalProgress(90, 85, 80), 50);
  assert.equal(computeWeightGoalProgress(100, 95, 90), 50);
  assert.equal(computeWeightGoalProgress(100, 100, 90), 0);
  assert.equal(computeWeightGoalProgress(70, 72, 70), null);
  assert.equal(computeWeightGoalProgress(0, 80, 70), null);
});

test("calculateNutrientGaps marks high when above 125% of target", () => {
  const gaps = calculateNutrientGaps([
    {
      key: "sugar",
      label: "Sugar",
      intake: 50,
      intakeUnit: "g",
      target: 30,
      targetUnit: "g",
    },
  ]);
  assert.equal(gaps[0]?.status, "high");
});

test("dedupeSnapshotRows keeps one row per item nutrient key", () => {
  const rows = dedupeSnapshotRows([
    {
      mealLogItemId: "item-1",
      nutrientId: "nutrient-1",
      amount: 10,
      unit: "g",
      source: "derived",
    },
    {
      mealLogItemId: "item-1",
      nutrientId: "nutrient-1",
      amount: 10,
      unit: "g",
      source: "derived",
    },
    {
      mealLogItemId: "item-1",
      nutrientId: "nutrient-2",
      amount: 5,
      unit: "g",
      source: "derived",
    },
  ]);

  assert.equal(rows.length, 2);
});

