import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as goldSchema from "../../shared/goldSchema.js";
import { env } from "./env.js";

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

// =============================================================================
// DATABASE CONFIGURATION (single pool — no read replica configured)
// =============================================================================

// Primary database connection
// PERF-02: max 15 leaves headroom for pgAdmin/Supabase Dashboard connections.
// idle_timeout is in SECONDS (postgres.js convention), NOT milliseconds.
export const queryClient = postgres(env.DATABASE_URL, {
  max: 15,
  idle_timeout: 30,
  connect_timeout: 10,
  transform: {
    undefined: null,
  },
});

// Drizzle instance
export const db = drizzle(queryClient, { schema: goldSchema });
// Alias for code that references dbRead (reads go to primary)
export const dbRead = db;

// Connection for migrations (auto-close after startup to free the slot)
export const migrationClient = postgres(env.DATABASE_URL, {
  max: 1,
});

// Set application name for easier debugging, then close migration client
queryClient`SET application_name = 'nutrition-app-api'`.catch(() => { });
migrationClient.end({ timeout: 5 }).catch(() => { });

// Function to set current user for RLS (session-level)
export async function setCurrentUser(userId: string) {
  try {
    await executeRaw(
      `SELECT set_config('app.current_user_id', $1, false)`,
      [userId]
    );
  } catch (error) {
    // If the GUC isn't defined, continue silently (dev-friendly)
    console.log(`[DB] RLS user context not available: ${error}`);
  }
}

/**
 * Execute raw SQL via postgres.js `unsafe()`. Use for DB functions, CTEs,
 * or complex queries that Drizzle ORM can't express.
 *
 * **SECURITY**: Always pass user input as `$1, $2, ...` parameters.
 * Never interpolate user data into the SQL string.
 *
 * @example executeRaw(`SELECT * FROM gold.recipes WHERE id = $1`, [recipeId])
 */
export async function executeRaw(sql: string, params: any[] = []) {
  return queryClient.unsafe(sql, params);
}

// Health check function
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await queryClient`SELECT 1`;
    return true;
  } catch (error) {
    console.error("Database health check failed:", error);
    return false;
  }
}

export default db;
