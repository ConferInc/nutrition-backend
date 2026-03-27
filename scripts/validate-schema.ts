/**
 * scripts/validate-schema.ts — B2C-036: Drizzle↔Code Schema Drift Detection
 *
 * Detects gold.* table references in raw SQL that have no matching Drizzle
 * definition in shared/goldSchema.ts.
 *
 * Usage:  npx tsx scripts/validate-schema.ts
 *         npm run validate:schema
 *
 * How it works:
 * 1. Reads shared/goldSchema.ts → extracts all gold.table("name") exports
 * 2. Globs all server/**\/*.ts files
 * 3. For each file, extracts gold.{table_name} references from SQL strings
 * 4. Compares: tables referenced in raw SQL but absent from Drizzle = gaps
 * 5. Exits 1 if B2C-relevant gaps detected, 0 if clean
 */

import { readFileSync, readdirSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";

// ── Configuration ──────────────────────────────────────────────────────────

/** Tables that are B2B-only or shared infra — expected NOT to be in Drizzle */
const B2B_AND_INFRA_TABLES = new Set([
  // B2B-only tables
  "b2b_alerts",
  "b2b_compliance_checks",
  "b2b_compliance_rules",
  "b2b_customer_allergens",
  "b2b_customer_dietary_preferences",
  "b2b_customer_health_conditions",
  "b2b_customer_health_profiles",
  "b2b_customers",
  "b2b_ip_allowlist",
  "b2b_role_permissions",
  "b2b_user_links",
  "b2b_users",
  "b2b_vendor_mappings",
  "b2b_webhooks",
  // Shared infra (B2B-oriented or pipeline-only)
  "api_keys",
  "vendors",
  "vendor_product_mappings",
]);

/** Known SQL keywords/functions that look like gold.xxx but aren't tables */
const SQL_FALSE_POSITIVES = new Set([
  "id",
  "name",
  "code",
  "category",
  "status",
  "type",
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "now",
  "true",
  "false",
  "null",
  "search_ingredients_trigram", // function, not a table
  "compute_b2c_bmi",            // function
  "compute_b2b_bmi",            // function
  "update_updated_at_column",   // function
  "sync_shopping_list_item_purchase_state", // function
]);

// ── Helpers ────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const SCHEMA_PATH = join(ROOT, "shared", "goldSchema.ts");
const SERVER_DIR = join(ROOT, "server");

function walkDir(dir: string, ext: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...walkDir(full, ext));
    } else if (entry.name.endsWith(ext) && !entry.name.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

// ── Step 1: Parse Drizzle table definitions ────────────────────────────────

function extractDrizzleTables(schemaContent: string): Set<string> {
  const tables = new Set<string>();
  // Match: gold.table("table_name" or gold.table('table_name'
  const regex = /gold\.table\(\s*["']([a-z0-9_]+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(schemaContent)) !== null) {
    tables.add(match[1]);
  }
  return tables;
}

// ── Step 2: Scan source files for raw SQL gold.xxx references ──────────────

interface TableRef {
  file: string;   // relative path
  line: number;
  snippet: string; // trimmed line content
}

function extractRawSqlTableRefs(
  filePath: string,
  rootDir: string
): Map<string, TableRef[]> {
  const refs = new Map<string, TableRef[]>();
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/);
  const relPath = relative(rootDir, filePath).replace(/\\/g, "/");

  // Match gold.{table_name} in SQL strings — must be followed by whitespace,
  // comma, paren, dot (for alias like gold.recipes r), or end of line
  const regex = /gold\.([a-z][a-z0-9_]*)/gi;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Only scan lines that look like they contain SQL (template literals, string args)
    // Skip import statements and type annotations
    if (
      line.trimStart().startsWith("import ") ||
      line.trimStart().startsWith("export type") ||
      line.trimStart().startsWith("export interface") ||
      line.trimStart().startsWith("//")
    ) {
      continue;
    }

    let match: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((match = regex.exec(line)) !== null) {
      const tableName = match[1].toLowerCase();

      // Skip false positives
      if (SQL_FALSE_POSITIVES.has(tableName)) continue;

      // Skip if this is a gold.table( definition line (Drizzle, not raw SQL)
      if (line.includes('gold.table(')) continue;

      const existing = refs.get(tableName) ?? [];
      existing.push({
        file: relPath,
        line: i + 1,
        snippet: line.trim().substring(0, 120),
      });
      refs.set(tableName, existing);
    }
  }

  return refs;
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  B2C-036: Drizzle ↔ Code Schema Drift Detection            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // 1. Parse goldSchema.ts
  let schemaContent: string;
  try {
    schemaContent = readFileSync(SCHEMA_PATH, "utf-8");
  } catch {
    console.error(`❌ Cannot read ${SCHEMA_PATH}`);
    process.exit(2);
  }

  const drizzleTables = extractDrizzleTables(schemaContent);
  console.log(`✅ ${drizzleTables.size} tables defined in goldSchema.ts`);
  console.log(`   ${[...drizzleTables].sort().join(", ")}\n`);

  // 2. Scan all service/route .ts files for raw SQL references
  const tsFiles = walkDir(SERVER_DIR, ".ts");
  console.log(`🔍 Scanning ${tsFiles.length} .ts files for raw SQL gold.* references...\n`);

  const allRefs = new Map<string, TableRef[]>();
  for (const file of tsFiles) {
    const fileRefs = extractRawSqlTableRefs(file, ROOT);
    for (const [table, refs] of fileRefs) {
      const existing = allRefs.get(table) ?? [];
      existing.push(...refs);
      allRefs.set(table, existing);
    }
  }

  // 3. Categorize
  const missing: Map<string, TableRef[]> = new Map();
  const b2bSkipped: string[] = [];
  const covered: string[] = [];

  for (const [table, refs] of [...allRefs].sort(([a], [b]) => a.localeCompare(b))) {
    if (B2B_AND_INFRA_TABLES.has(table)) {
      b2bSkipped.push(table);
    } else if (drizzleTables.has(table)) {
      covered.push(table);
    } else {
      missing.set(table, refs);
    }
  }

  // 4. Report
  if (covered.length > 0) {
    console.log(`✅ ${covered.length} tables referenced in code AND defined in Drizzle:`);
    console.log(`   ${covered.join(", ")}\n`);
  }

  if (b2bSkipped.length > 0) {
    console.log(`ℹ️  ${b2bSkipped.length} B2B/infra tables skipped (not relevant to B2C):`);
    console.log(`   ${b2bSkipped.join(", ")}\n`);
  }

  if (missing.size === 0) {
    console.log("🎉 No schema drift detected! All referenced tables have Drizzle definitions.\n");
    process.exit(0);
  }

  console.log(`⚠️  ${missing.size} table(s) referenced in code but MISSING from goldSchema.ts:\n`);
  for (const [table, refs] of missing) {
    const locations = refs
      .map((r) => `${r.file}:${r.line}`)
      .filter((v, i, a) => a.indexOf(v) === i); // dedupe
    console.log(`  ├─ ${table} (${locations.length} ref${locations.length > 1 ? "s" : ""})`);
    for (const loc of locations.slice(0, 5)) {
      console.log(`  │    ${loc}`);
    }
    if (locations.length > 5) {
      console.log(`  │    ... and ${locations.length - 5} more`);
    }
  }

  console.log(`\n❌ FAIL: ${missing.size} B2C table(s) need Drizzle definitions in goldSchema.ts\n`);
  process.exit(1);
}

main();
