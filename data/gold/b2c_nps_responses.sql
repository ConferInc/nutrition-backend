-- B2C-026: NPS Survey Responses
-- Run this DDL manually in the database

CREATE TABLE IF NOT EXISTS gold.b2c_nps_responses (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  b2c_customer_id UUID NOT NULL REFERENCES gold.b2c_customers(id) ON DELETE CASCADE,
  score           SMALLINT CHECK (score >= 0 AND score <= 10),  -- NPS 0-10, NULL if dismissed
  feedback_text   TEXT,
  trigger_type    VARCHAR(50) NOT NULL DEFAULT 'session_count',
  dismissed       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nps_customer
  ON gold.b2c_nps_responses (b2c_customer_id, created_at DESC);

-- Grant access to the service role
GRANT SELECT, INSERT ON gold.b2c_nps_responses TO service_role;
