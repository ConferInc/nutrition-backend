-- Migration 037: Campaign engagement events
-- Stores per-recipient open/click/bounce/unsubscribe events forwarded
-- from Resend webhooks. Powers campaign performance analytics.

CREATE TABLE IF NOT EXISTS gold.b2b_campaign_events (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id    uuid NOT NULL REFERENCES gold.b2b_campaigns(id) ON DELETE CASCADE,
  vendor_id      uuid NOT NULL,
  recipient_email text NOT NULL,
  event_type     text NOT NULL CHECK (event_type IN ('sent', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed')),
  resend_email_id text,          -- Resend's internal email_id for de-duplication
  click_url      text,           -- populated for event_type='clicked'
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup by campaign for the analytics aggregation endpoint
CREATE INDEX IF NOT EXISTS idx_b2b_campaign_events_campaign
  ON gold.b2b_campaign_events (campaign_id, event_type);

-- De-duplicate Resend events (same email_id + event_type should never be inserted twice)
CREATE UNIQUE INDEX IF NOT EXISTS idx_b2b_campaign_events_dedup
  ON gold.b2b_campaign_events (resend_email_id, event_type)
  WHERE resend_email_id IS NOT NULL;

-- Add resend_email_id column to b2b_campaigns so we can map webhooks back to campaigns
ALTER TABLE gold.b2b_campaigns
  ADD COLUMN IF NOT EXISTS resend_batch_ids jsonb DEFAULT '[]'::jsonb;

COMMENT ON TABLE gold.b2b_campaign_events IS
  'Per-recipient engagement events forwarded from Resend webhooks. '
  'Populated by POST /api/v1/reports/webhook/resend for opened/clicked events '
  'and by the campaigns send endpoint for sent events.';
