-- PRD-33: Contextual Recommendations — Schema Migration
-- Adds location_state and location_zip_code to gold.households
-- for regional food recommendations and location-based context

ALTER TABLE gold.households ADD COLUMN IF NOT EXISTS location_state VARCHAR(100);
ALTER TABLE gold.households ADD COLUMN IF NOT EXISTS location_zip_code VARCHAR(20);

-- Verify
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'gold' AND table_name = 'households'
  AND column_name IN ('location_state', 'location_zip_code');
