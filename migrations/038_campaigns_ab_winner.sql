-- Migration 038: A/B test winner tracking on campaigns
-- Adds ab_winner column so admins can pick a variant after reviewing analytics,
-- and ab_sent_variant per-event so analytics can break down by variant.

ALTER TABLE gold.b2b_campaigns
  ADD COLUMN IF NOT EXISTS ab_winner text CHECK (ab_winner IN ('a', 'b'));

ALTER TABLE gold.b2b_campaign_events
  ADD COLUMN IF NOT EXISTS ab_variant text CHECK (ab_variant IN ('a', 'b'));
