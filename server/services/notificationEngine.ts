// server/services/notificationEngine.ts
// PRD-29: Auto Notification Engine — 10 triggers with dedup + fallback templates
// ─────────────────────────────────────────────────────────────────────────────

import { executeRaw } from "../config/database.js";
import { createNotification } from "./notifications.js";
import { getStreak } from "./mealLog.js";
import { ragNotifications } from "./ragClient.js";

// ── PRD-32: Configurable Daily Cap ───────────────────────────────────────────

const MAX_DAILY_NOTIFICATIONS = parseInt(
    process.env.MAX_DAILY_NOTIFICATIONS ?? "4",
    10
);

// ── Types ────────────────────────────────────────────────────────────────────

interface FallbackTemplate {
    title: string;
    body: string;
    icon: string;
    type: "meal" | "nutrition" | "grocery" | "budget" | "family" | "system";
    action_url: string;
}

interface TriggerResult {
    shouldFire: boolean;
    context: Record<string, unknown>;
}

type TriggerType =
    | "missed_breakfast"
    | "missed_lunch"
    | "missed_dinner"
    | "high_fat_2day"
    | "low_protein_3day"
    | "calorie_overshoot_3day"
    | "no_water"
    | "streak_milestone"
    | "streak_broken"
    | "suggest_breakfast"
    | "suggest_lunch"
    | "suggest_dinner";

// ── Fallback Templates (all 10 user stories) ────────────────────────────────

const FALLBACK_TEMPLATES: Record<TriggerType, FallbackTemplate> = {
    // AN-1: Missed breakfast
    missed_breakfast: {
        title: "Good morning! 🌅",
        body: "You haven't logged breakfast yet — want to log it now?",
        icon: "🍳",
        type: "meal",
        action_url: "/meal-log?type=breakfast",
    },
    // AN-2: Missed lunch
    missed_lunch: {
        title: "Looks like you've been busy! 🕐",
        body: "Tap here to quickly log your lunch before the day gets away",
        icon: "🥪",
        type: "meal",
        action_url: "/meal-log?type=lunch",
    },
    // AN-3: High fat (2 days)
    high_fat_2day: {
        title: "Nutrition insight 📊",
        body: "Your fat intake has been trending high — here are some lighter alternatives for today",
        icon: "🥗",
        type: "nutrition",
        action_url: "/search?q=low+fat",
    },
    // AN-4: Low protein (3 days)
    low_protein_3day: {
        title: "Protein check 💪",
        body: "You've been getting less protein than your goal — try adding these high-protein options",
        icon: "🥩",
        type: "nutrition",
        action_url: "/search?q=high+protein",
    },
    // AN-5: No water
    no_water: {
        title: "Stay hydrated! 💧",
        body: "You haven't tracked any water today — remember to drink up!",
        icon: "💧",
        type: "meal",
        action_url: "/meal-log",
    },
    // AN-6: Streak milestone (7, 14, 30, 60, 100)
    streak_milestone: {
        title: "🔥 Amazing streak!",
        body: "You've maintained an incredible logging streak! Keep it going!",
        icon: "🔥",
        type: "system",
        action_url: "/meal-log",
    },
    // AN-7: Streak broken
    streak_broken: {
        title: "Don't lose momentum! 📅",
        body: "Your logging streak ended — log today to start a new one!",
        icon: "📅",
        type: "system",
        action_url: "/meal-log",
    },
    // AN-8: Calorie overshoot (3 days)
    calorie_overshoot_3day: {
        title: "Calorie update 🎯",
        body: "You've been over your calorie goal this week — would you like to explore lighter meals?",
        icon: "🎯",
        type: "nutrition",
        action_url: "/search?q=low+calorie",
    },
    // AN-9: Proactive breakfast suggestion
    suggest_breakfast: {
        title: "Good morning! 🌞",
        body: "Start your day right — check out some breakfast ideas that match your goals!",
        icon: "🥣",
        type: "meal",
        action_url: "/search?q=breakfast",
    },
    // AN-10: Proactive lunch suggestion
    suggest_lunch: {
        title: "Lunchtime! 🍽️",
        body: "Looking for lunch? Here are some options that fit your calorie budget",
        icon: "🍽️",
        type: "meal",
        action_url: "/search?q=lunch",
    },
    // AN-11: Missed dinner (PRD-32)
    missed_dinner: {
        title: "How was dinner? 🌙",
        body: "You haven't logged dinner yet — tap to log what you had!",
        icon: "🍽️",
        type: "meal",
        action_url: "/meal-log?type=dinner",
    },
    // AN-12: Proactive dinner suggestion (PRD-32)
    suggest_dinner: {
        title: "Dinner time! 🌅",
        body: "Looking for dinner? Here are options that fit your remaining calorie budget",
        icon: "🥘",
        type: "meal",
        action_url: "/search?q=dinner",
    },
};

// Streak milestones we celebrate
const STREAK_MILESTONES = [7, 14, 30, 60, 100];

// ── PRD-32: Trigger Priority Map (lower = higher priority) ──────────────────

const TRIGGER_PRIORITY: Record<TriggerType, number> = {
    // P1: Meal logging reminders — direct user action prompt (highest engagement)
    missed_breakfast: 1,
    missed_lunch: 1,
    missed_dinner: 1,
    // P2: Meal suggestions — proactive value ("here's what to eat")
    suggest_breakfast: 2,
    suggest_lunch: 2,
    suggest_dinner: 2,
    // P3: Nutritional gap alerts — health insight / educational
    low_protein_3day: 3,
    high_fat_2day: 3,
    calorie_overshoot_3day: 3,
    // P4: Engagement / Gamification — nice-to-have, lowest impact
    no_water: 4,
    streak_milestone: 4,
    streak_broken: 4,
};

// ── Timezone Helpers ─────────────────────────────────────────────────────────

function normalizeTimeZone(tz: string): string {
    try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
        return tz;
    } catch {
        return "UTC";
    }
}

function getLocalHour(timezone: string): number {
    const formatter = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: normalizeTimeZone(timezone),
    });
    return parseInt(formatter.format(new Date()), 10);
}

function getLocalDateStr(timezone: string): string {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: normalizeTimeZone(timezone),
    });
    return formatter.format(new Date()); // YYYY-MM-DD
}

// ── Dedup Check ──────────────────────────────────────────────────────────────

async function alreadyDispatched(
    customerId: string,
    triggerType: string,
    triggerDate: string
): Promise<boolean> {
    const rows = await executeRaw(
        `SELECT 1 FROM gold.b2c_notification_dispatch_log
         WHERE b2c_customer_id = $1 AND trigger_type = $2 AND trigger_date = $3
         LIMIT 1`,
        [customerId, triggerType, triggerDate]
    );
    return rows.length > 0;
}

async function recordDispatch(
    customerId: string,
    triggerType: string,
    triggerDate: string,
    notificationId: string
): Promise<void> {
    await executeRaw(
        `INSERT INTO gold.b2c_notification_dispatch_log
             (b2c_customer_id, trigger_type, trigger_date, notification_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (b2c_customer_id, trigger_type, trigger_date) DO NOTHING`,
        [customerId, triggerType, triggerDate, notificationId]
    );
}

// ── PRD-32: Daily Dispatch Count (timezone-aware) ────────────────────────────

async function getTodayDispatchCount(
    customerId: string,
    todayStr: string
): Promise<number> {
    const rows = await executeRaw(
        `SELECT COUNT(*) AS cnt
         FROM gold.b2c_notification_dispatch_log
         WHERE b2c_customer_id = $1
           AND trigger_date = $2`,
        [customerId, todayStr]
    );
    return parseInt((rows[0] as any)?.cnt ?? "0", 10);
}

// ── Trigger Functions ────────────────────────────────────────────────────────

async function checkMissedBreakfast(
    customerId: string,
    todayStr: string,
    localHour: number
): Promise<TriggerResult> {
    // Only fire between 11 AM – 2 PM local
    if (localHour < 11 || localHour >= 14) return { shouldFire: false, context: {} };

    const rows = await executeRaw(
        `SELECT 1 FROM gold.meal_log_items mli
         JOIN gold.meal_logs ml ON ml.id = mli.meal_log_id
         WHERE ml.b2c_customer_id = $1
           AND ml.log_date = $2
           AND mli.meal_type = 'breakfast'
         LIMIT 1`,
        [customerId, todayStr]
    );
    return { shouldFire: rows.length === 0, context: { localHour } };
}

async function checkMissedLunch(
    customerId: string,
    todayStr: string,
    localHour: number
): Promise<TriggerResult> {
    // Only fire between 3 PM – 6 PM local
    if (localHour < 15 || localHour >= 18) return { shouldFire: false, context: {} };

    const rows = await executeRaw(
        `SELECT 1 FROM gold.meal_log_items mli
         JOIN gold.meal_logs ml ON ml.id = mli.meal_log_id
         WHERE ml.b2c_customer_id = $1
           AND ml.log_date = $2
           AND mli.meal_type = 'lunch'
         LIMIT 1`,
        [customerId, todayStr]
    );
    return { shouldFire: rows.length === 0, context: { localHour } };
}

async function checkHighFat2Day(
    customerId: string,
    todayStr: string,
    localHour: number
): Promise<TriggerResult> {
    // Only fire between 9 AM – 9 PM local
    if (localHour < 9 || localHour >= 21) return { shouldFire: false, context: {} };
    const rows = await executeRaw(
        `WITH recent AS (
           SELECT total_fat_g::numeric AS fat
           FROM gold.meal_logs
           WHERE b2c_customer_id = $1
             AND log_date >= ($2::date - INTERVAL '1 day')
             AND log_date <= $2::date
             AND total_calories > 0
         ), target AS (
           SELECT target_fat_g FROM gold.b2c_customer_health_profiles
           WHERE b2c_customer_id = $1 LIMIT 1
         )
         SELECT
           AVG(r.fat) AS avg_fat,
           t.target_fat_g
         FROM recent r, target t
         GROUP BY t.target_fat_g`,
        [customerId, todayStr]
    );
    const row = rows[0] as any;
    if (!row?.target_fat_g || !row?.avg_fat) return { shouldFire: false, context: {} };
    const ratio = Number(row.avg_fat) / Number(row.target_fat_g);
    return { shouldFire: ratio > 1.3, context: { avgFat: row.avg_fat, target: row.target_fat_g, ratio } };
}

async function checkLowProtein3Day(
    customerId: string,
    todayStr: string,
    localHour: number
): Promise<TriggerResult> {
    // Only fire between 9 AM – 9 PM local
    if (localHour < 9 || localHour >= 21) return { shouldFire: false, context: {} };
    const rows = await executeRaw(
        `WITH recent AS (
           SELECT total_protein_g::numeric AS protein
           FROM gold.meal_logs
           WHERE b2c_customer_id = $1
             AND log_date >= ($2::date - INTERVAL '2 days')
             AND log_date <= $2::date
             AND total_calories > 0
         ), target AS (
           SELECT target_protein_g FROM gold.b2c_customer_health_profiles
           WHERE b2c_customer_id = $1 LIMIT 1
         )
         SELECT
           AVG(r.protein) AS avg_protein,
           t.target_protein_g
         FROM recent r, target t
         GROUP BY t.target_protein_g`,
        [customerId, todayStr]
    );
    const row = rows[0] as any;
    if (!row?.target_protein_g || !row?.avg_protein) return { shouldFire: false, context: {} };
    const ratio = Number(row.avg_protein) / Number(row.target_protein_g);
    return { shouldFire: ratio < 0.7, context: { avgProtein: row.avg_protein, target: row.target_protein_g, ratio } };
}

async function checkCalorieOvershoot3Day(
    customerId: string,
    todayStr: string,
    localHour: number
): Promise<TriggerResult> {
    // Only fire between 9 AM – 9 PM local
    if (localHour < 9 || localHour >= 21) return { shouldFire: false, context: {} };
    const rows = await executeRaw(
        `WITH recent AS (
           SELECT total_calories
           FROM gold.meal_logs
           WHERE b2c_customer_id = $1
             AND log_date >= ($2::date - INTERVAL '2 days')
             AND log_date <= $2::date
             AND total_calories > 0
         ), target AS (
           SELECT target_calories FROM gold.b2c_customer_health_profiles
           WHERE b2c_customer_id = $1 LIMIT 1
         )
         SELECT
           AVG(r.total_calories) AS avg_cal,
           t.target_calories
         FROM recent r, target t
         GROUP BY t.target_calories`,
        [customerId, todayStr]
    );
    const row = rows[0] as any;
    if (!row?.target_calories || !row?.avg_cal) return { shouldFire: false, context: {} };
    const ratio = Number(row.avg_cal) / Number(row.target_calories);
    return { shouldFire: ratio > 1.15, context: { avgCal: row.avg_cal, target: row.target_calories, ratio } };
}

async function checkNoWater(
    customerId: string,
    todayStr: string,
    localHour: number
): Promise<TriggerResult> {
    // Only fire between 2 PM – 9 PM local
    if (localHour < 14 || localHour >= 21) return { shouldFire: false, context: {} };

    const rows = await executeRaw(
        `SELECT water_ml FROM gold.meal_logs
         WHERE b2c_customer_id = $1 AND log_date = $2
         LIMIT 1`,
        [customerId, todayStr]
    );
    const waterMl = (rows[0] as any)?.water_ml ?? 0;
    return { shouldFire: Number(waterMl) === 0, context: { waterMl } };
}

async function checkStreakMilestone(
    customerId: string,
    localHour: number
): Promise<TriggerResult> {
    // Only fire between 9 AM – 9 PM local
    if (localHour < 9 || localHour >= 21) return { shouldFire: false, context: {} };
    const streak = await getStreak(customerId);
    const current = streak.currentStreak;
    const isMilestone = STREAK_MILESTONES.includes(current);
    return {
        shouldFire: isMilestone,
        context: { currentStreak: current, milestone: current },
    };
}

async function checkStreakBroken(
    customerId: string,
    localHour: number
): Promise<TriggerResult> {
    // Only fire between 9 AM – 9 PM local
    if (localHour < 9 || localHour >= 21) return { shouldFire: false, context: {} };
    const streak = await getStreak(customerId);
    // Streak is broken if lastLoggedDate is before yesterday and previous streak was > 1
    if (!streak.lastLoggedDate) return { shouldFire: false, context: {} };

    const today = new Date();
    const lastLogged = new Date(streak.lastLoggedDate + "T00:00:00Z");
    const diffDays = Math.round((today.getTime() - lastLogged.getTime()) / 86400000);

    return {
        shouldFire: diffDays > 1 && streak.longestStreak > 1,
        context: {
            lastLoggedDate: streak.lastLoggedDate,
            daysSinceLastLog: diffDays,
            previousStreak: streak.longestStreak,
        },
    };
}

async function checkSuggestBreakfast(
    customerId: string,
    todayStr: string,
    localHour: number
): Promise<TriggerResult> {
    // Only suggest between 7-9 AM local
    if (localHour < 7 || localHour >= 10) return { shouldFire: false, context: {} };

    const rows = await executeRaw(
        `SELECT 1 FROM gold.meal_log_items mli
         JOIN gold.meal_logs ml ON ml.id = mli.meal_log_id
         WHERE ml.b2c_customer_id = $1
           AND ml.log_date = $2
           AND mli.meal_type = 'breakfast'
         LIMIT 1`,
        [customerId, todayStr]
    );
    return { shouldFire: rows.length === 0, context: { localHour } };
}

async function checkSuggestLunch(
    customerId: string,
    todayStr: string,
    localHour: number
): Promise<TriggerResult> {
    // Only suggest between 11:30 AM - 12:30 PM (we approximate with hour 11-12)
    if (localHour < 11 || localHour >= 13) return { shouldFire: false, context: {} };

    const rows = await executeRaw(
        `SELECT 1 FROM gold.meal_log_items mli
         JOIN gold.meal_logs ml ON ml.id = mli.meal_log_id
         WHERE ml.b2c_customer_id = $1
           AND ml.log_date = $2
           AND mli.meal_type = 'lunch'
         LIMIT 1`,
        [customerId, todayStr]
    );
    return { shouldFire: rows.length === 0, context: { localHour } };
}

// ── PRD-32: Dinner Triggers ──────────────────────────────────────────────────

async function checkMissedDinner(
    customerId: string,
    todayStr: string,
    localHour: number
): Promise<TriggerResult> {
    // Only fire between 8 PM – 10 PM local
    if (localHour < 20 || localHour >= 22) return { shouldFire: false, context: {} };

    const rows = await executeRaw(
        `SELECT 1 FROM gold.meal_log_items mli
         JOIN gold.meal_logs ml ON ml.id = mli.meal_log_id
         WHERE ml.b2c_customer_id = $1
           AND ml.log_date = $2
           AND mli.meal_type = 'dinner'
         LIMIT 1`,
        [customerId, todayStr]
    );
    return { shouldFire: rows.length === 0, context: { localHour } };
}

async function checkSuggestDinner(
    customerId: string,
    todayStr: string,
    localHour: number
): Promise<TriggerResult> {
    // Only suggest between 5 PM – 7 PM local (before dinner)
    if (localHour < 17 || localHour >= 19) return { shouldFire: false, context: {} };

    const rows = await executeRaw(
        `SELECT 1 FROM gold.meal_log_items mli
         JOIN gold.meal_logs ml ON ml.id = mli.meal_log_id
         WHERE ml.b2c_customer_id = $1
           AND ml.log_date = $2
           AND mli.meal_type = 'dinner'
         LIMIT 1`,
        [customerId, todayStr]
    );
    return { shouldFire: rows.length === 0, context: { localHour } };
}

// ── Main Orchestrator (PRD-32: Cap + Priority) ──────────────────────────────

export async function evaluateAndDispatchNotifications(
    customerId: string,
    clientTimezone?: string
): Promise<{ evaluated: number; dispatched: number; capped: boolean }> {
    let evaluated = 0;
    let dispatched = 0;

    // Resolve timezone: DB → client header → UTC fallback
    let timezone = "UTC";
    try {
        const tzRows = await executeRaw(
            `SELECT h.timezone FROM gold.households h
             JOIN gold.b2c_customers c ON c.household_id = h.id
             WHERE c.id = $1
             LIMIT 1`,
            [customerId]
        );
        timezone = (tzRows[0] as any)?.timezone || clientTimezone || "UTC";
    } catch {
        timezone = clientTimezone || "UTC";
    }

    console.log(`[NotificationEngine] customerId=${customerId} timezone=${timezone}`);

    const localHour = getLocalHour(timezone);
    const todayStr = getLocalDateStr(timezone);

    // ── PRD-32: Check daily cap — early exit if user already at limit ────────
    const todayCount = await getTodayDispatchCount(customerId, todayStr);
    if (todayCount >= MAX_DAILY_NOTIFICATIONS) {
        console.log(
            `[NotificationEngine] Cap reached for ${customerId} (${todayCount}/${MAX_DAILY_NOTIFICATIONS})`
        );
        return { evaluated: 0, dispatched: 0, capped: true };
    }
    const remaining = MAX_DAILY_NOTIFICATIONS - todayCount;

    // Define all 12 triggers with their check functions
    const triggers: Array<{
        type: TriggerType;
        check: () => Promise<TriggerResult>;
    }> = [
            { type: "missed_breakfast", check: () => checkMissedBreakfast(customerId, todayStr, localHour) },
            { type: "missed_lunch", check: () => checkMissedLunch(customerId, todayStr, localHour) },
            { type: "missed_dinner", check: () => checkMissedDinner(customerId, todayStr, localHour) },
            { type: "high_fat_2day", check: () => checkHighFat2Day(customerId, todayStr, localHour) },
            { type: "low_protein_3day", check: () => checkLowProtein3Day(customerId, todayStr, localHour) },
            { type: "calorie_overshoot_3day", check: () => checkCalorieOvershoot3Day(customerId, todayStr, localHour) },
            { type: "no_water", check: () => checkNoWater(customerId, todayStr, localHour) },
            { type: "streak_milestone", check: () => checkStreakMilestone(customerId, localHour) },
            { type: "streak_broken", check: () => checkStreakBroken(customerId, localHour) },
            { type: "suggest_breakfast", check: () => checkSuggestBreakfast(customerId, todayStr, localHour) },
            { type: "suggest_lunch", check: () => checkSuggestLunch(customerId, todayStr, localHour) },
            { type: "suggest_dinner", check: () => checkSuggestDinner(customerId, todayStr, localHour) },
        ];

    // ── PRD-32: Collect eligible triggers ─────────────────────────────────────
    interface EligibleTrigger {
        type: TriggerType;
        result: TriggerResult;
    }
    const eligible: EligibleTrigger[] = [];

    for (const trigger of triggers) {
        evaluated++;
        try {
            // Skip if already dispatched today (per-type dedup — unchanged)
            if (await alreadyDispatched(customerId, trigger.type, todayStr)) {
                continue;
            }

            const result = await trigger.check();
            if (result.shouldFire) {
                eligible.push({ type: trigger.type, result });
            }
        } catch (err) {
            console.error(`[NotificationEngine] Error evaluating ${trigger.type}:`, err);
        }
    }

    // ── PRD-32: Sort by priority, dispatch top N ─────────────────────────────
    eligible.sort((a, b) => TRIGGER_PRIORITY[a.type] - TRIGGER_PRIORITY[b.type]);
    const toDispatch = eligible.slice(0, remaining);

    for (const { type, result } of toDispatch) {
        try {
            const template = FALLBACK_TEMPLATES[type];

            // Start with fallback template values
            let title = template.title;
            let body = template.body;
            let icon = template.icon;
            let actionUrl = template.action_url;
            let notifType = template.type;

            // Customize fallback body for streak milestones
            if (type === "streak_milestone" && result.context.milestone) {
                body = `You've logged meals for ${result.context.milestone} days in a row! Keep it going! 🔥`;
            }

            // ── RAG-first: try RAG pipeline for richer content ──
            try {
                const ragResult = await ragNotifications({
                    customer_id: customerId,
                    trigger_type: type,
                    meal_log_summary: result.context as Record<string, unknown>,
                    timezone,
                });

                if (ragResult) {
                    title = ragResult.title || title;
                    body = ragResult.body || body;
                    icon = ragResult.icon || icon;
                    actionUrl = ragResult.action_url || actionUrl;
                    // Validate RAG type against DB constraint (defense-in-depth)
                    const validTypes = ["meal", "nutrition", "grocery", "budget", "family", "system"] as const;
                    type ValidType = (typeof validTypes)[number];
                    notifType = validTypes.includes(ragResult.type as ValidType)
                        ? (ragResult.type as ValidType)
                        : template.type;
                    console.log(`[NotificationEngine] RAG content used for ${type}`);
                }
            } catch (ragErr) {
                // RAG failed — use fallback template (already set above)
                console.warn(`[NotificationEngine] RAG failed for ${type}, using fallback:`, ragErr);
            }

            const notification = await createNotification({
                customerId,
                type: notifType,
                title,
                body,
                icon,
                actionUrl,
            });

            await recordDispatch(customerId, type, todayStr, notification.id);
            dispatched++;
            console.log(`[NotificationEngine] Dispatched ${type} for ${customerId}`);
        } catch (err) {
            console.error(`[NotificationEngine] Error dispatching ${type}:`, err);
        }
    }

    const capped = todayCount + dispatched >= MAX_DAILY_NOTIFICATIONS;
    console.log(
        `[NotificationEngine] Done: evaluated=${evaluated} eligible=${eligible.length} dispatched=${dispatched} capped=${capped}`
    );
    return { evaluated, dispatched, capped };
}

// ── Batch Evaluation (for cron) ──────────────────────────────────────────────

export async function getActiveCustomerIds(): Promise<string[]> {
    const rows = await executeRaw(
        `SELECT DISTINCT b2c_customer_id
         FROM gold.meal_logs
         WHERE log_date >= (CURRENT_DATE - INTERVAL '7 days')
         LIMIT 1000`,
        []
    );
    return (rows as any[]).map((r) => r.b2c_customer_id);
}
