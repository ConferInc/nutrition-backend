module.exports = async () => {
  // Minimal env vars for integration tests that import modules requiring env
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://placeholder.supabase.co";
  process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "placeholder-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-key";
  process.env.APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT || "https://cloud.appwrite.io/v1";
  process.env.APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID || "placeholder";
  process.env.APPWRITE_API_KEY = process.env.APPWRITE_API_KEY || "placeholder";
  process.env.APPWRITE_DB_ID = process.env.APPWRITE_DB_ID || "placeholder";
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://placeholder:placeholder@localhost:5432/placeholder";
};