// server/services/contextBuilder.test.ts
// Tests for pure functions (deriveMealTimeSlot, deriveSeason)
// Inlined to avoid env validation from transitive database.js import
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Inlined pure helpers from contextBuilder.ts ──

function getLocalHour(now: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric", hour12: false, timeZone: timezone,
    }).formatToParts(now);
    const hourPart = parts.find((p) => p.type === "hour");
    return parseInt(hourPart?.value ?? "12", 10);
  } catch {
    return now.getUTCHours();
  }
}

function isNorthernHemisphere(timezone: string): boolean {
  const tz = timezone.toLowerCase();
  if (
    tz.startsWith("australia/") || tz.startsWith("antarctica/") ||
    tz === "pacific/auckland" || tz === "pacific/fiji" ||
    (tz.startsWith("africa/") && (tz.includes("johannesburg") || tz.includes("harare")))
  ) return false;
  if (
    tz === "america/buenos_aires" || tz === "america/argentina/buenos_aires" ||
    tz === "america/sao_paulo" || tz === "america/santiago" ||
    tz === "america/montevideo"
  ) return false;
  return true;
}

type MealTimeSlot = "morning" | "afternoon" | "evening" | "late_night";
type Season = "spring" | "summer" | "fall" | "winter";

function deriveMealTimeSlot(timezone: string): MealTimeSlot {
  const now = new Date();
  const localHour = getLocalHour(now, timezone);
  if (localHour >= 5 && localHour < 12) return "morning";
  if (localHour >= 12 && localHour < 17) return "afternoon";
  if (localHour >= 17 && localHour < 22) return "evening";
  return "late_night";
}

function deriveSeason(timezone: string): Season {
  const month = new Date().getMonth() + 1;
  const isNorthern = isNorthernHemisphere(timezone);
  if (month >= 3 && month <= 5) return isNorthern ? "spring" : "fall";
  if (month >= 6 && month <= 8) return isNorthern ? "summer" : "winter";
  if (month >= 9 && month <= 11) return isNorthern ? "fall" : "spring";
  return isNorthern ? "winter" : "summer";
}

// ── Tests ────────────────────────────────────────────────────────

describe("deriveMealTimeSlot", () => {
  it("returns valid slot for America/New_York", () => {
    const slot = deriveMealTimeSlot("America/New_York");
    assert.ok(["morning", "afternoon", "evening", "late_night"].includes(slot));
  });

  it("returns valid slot for UTC", () => {
    const slot = deriveMealTimeSlot("UTC");
    assert.ok(["morning", "afternoon", "evening", "late_night"].includes(slot));
  });

  it("returns valid slot for Asia/Kolkata", () => {
    const slot = deriveMealTimeSlot("Asia/Kolkata");
    assert.ok(["morning", "afternoon", "evening", "late_night"].includes(slot));
  });

  it("handles invalid timezone gracefully", () => {
    const slot = deriveMealTimeSlot("Invalid/Timezone");
    assert.ok(["morning", "afternoon", "evening", "late_night"].includes(slot));
  });
});

describe("deriveSeason", () => {
  it("returns valid season for Northern Hemisphere", () => {
    const season = deriveSeason("America/New_York");
    assert.ok(["spring", "summer", "fall", "winter"].includes(season));
  });

  it("returns valid season for Southern Hemisphere", () => {
    const season = deriveSeason("Australia/Sydney");
    assert.ok(["spring", "summer", "fall", "winter"].includes(season));
  });

  it("Northern and Southern hemispheres return opposite seasons", () => {
    const north = deriveSeason("America/New_York");
    const south = deriveSeason("Australia/Sydney");
    const opposites: Record<string, string> = {
      spring: "fall", summer: "winter", fall: "spring", winter: "summer",
    };
    assert.equal(south, opposites[north],
      `Southern (${south}) should be opposite of Northern (${north})`);
  });
});

describe("isNorthernHemisphere", () => {
  it("classifies US timezones as Northern", () => {
    assert.ok(isNorthernHemisphere("America/New_York"));
    assert.ok(isNorthernHemisphere("America/Los_Angeles"));
  });

  it("classifies Australian timezones as Southern", () => {
    assert.ok(!isNorthernHemisphere("Australia/Sydney"));
    assert.ok(!isNorthernHemisphere("Australia/Melbourne"));
  });

  it("classifies South American cities as Southern", () => {
    assert.ok(!isNorthernHemisphere("America/Buenos_Aires"));
    assert.ok(!isNorthernHemisphere("America/Sao_Paulo"));
  });

  it("classifies European timezones as Northern", () => {
    assert.ok(isNorthernHemisphere("Europe/London"));
    assert.ok(isNorthernHemisphere("Europe/Berlin"));
  });
});

/** Same hour thresholds as deriveMealTimeSlot in contextBuilder.ts, with fixed `now`. */
function deriveMealTimeSlotAt(timezone: string, now: Date): MealTimeSlot {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: timezone,
  }).formatToParts(now);
  const hourPart = parts.find((p) => p.type === "hour");
  const localHour = parseInt(hourPart?.value ?? "12", 10);
  if (localHour >= 5 && localHour < 12) return "morning";
  if (localHour >= 12 && localHour < 17) return "afternoon";
  if (localHour >= 17 && localHour < 22) return "evening";
  return "late_night";
}

describe("deriveMealTimeSlot boundaries (UTC, fixed clock)", () => {
  it("04:00 UTC is late_night", () => {
    const now = new Date(Date.UTC(2026, 5, 15, 4, 30, 0));
    assert.equal(deriveMealTimeSlotAt("UTC", now), "late_night");
  });

  it("05:00 UTC is morning", () => {
    const now = new Date(Date.UTC(2026, 5, 15, 5, 0, 0));
    assert.equal(deriveMealTimeSlotAt("UTC", now), "morning");
  });

  it("11:59 UTC morning and 12:00 UTC afternoon", () => {
    assert.equal(
      deriveMealTimeSlotAt("UTC", new Date(Date.UTC(2026, 5, 15, 11, 59, 0))),
      "morning"
    );
    assert.equal(
      deriveMealTimeSlotAt("UTC", new Date(Date.UTC(2026, 5, 15, 12, 0, 0))),
      "afternoon"
    );
  });

  it("16:59 UTC afternoon and 17:00 UTC evening", () => {
    assert.equal(
      deriveMealTimeSlotAt("UTC", new Date(Date.UTC(2026, 5, 15, 16, 59, 0))),
      "afternoon"
    );
    assert.equal(
      deriveMealTimeSlotAt("UTC", new Date(Date.UTC(2026, 5, 15, 17, 0, 0))),
      "evening"
    );
  });

  it("21:59 UTC evening and 22:00 UTC late_night", () => {
    assert.equal(
      deriveMealTimeSlotAt("UTC", new Date(Date.UTC(2026, 5, 15, 21, 59, 0))),
      "evening"
    );
    assert.equal(
      deriveMealTimeSlotAt("UTC", new Date(Date.UTC(2026, 5, 15, 22, 0, 0))),
      "late_night"
    );
  });
});
