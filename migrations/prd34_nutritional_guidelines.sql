-- PRD-34: USDA 2025 Food Pyramid Integration
-- Creates reference table for nutritional guidelines + seed data
-- Run: psql -f migrations/prd34_nutritional_guidelines.sql

CREATE TABLE IF NOT EXISTS gold.nutritional_guidelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name VARCHAR(50) NOT NULL,
  food_group VARCHAR(100) NOT NULL,
  daily_target_min NUMERIC(10,2),
  daily_target_max NUMERIC(10,2),
  daily_target_unit VARCHAR(20) NOT NULL,
  calorie_percentage NUMERIC(5,2),
  pyramid_priority INTEGER,
  calorie_basis INTEGER DEFAULT 2000,
  scaling_factor NUMERIC(5,3) DEFAULT 1.0,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed USDA 2025 food group targets (based on 2,000 kcal/day)
INSERT INTO gold.nutritional_guidelines
  (model_name, food_group, daily_target_min, daily_target_max, daily_target_unit, calorie_percentage, pyramid_priority, notes)
VALUES
  ('usda_2025', 'protein',       5.5, 6.5, 'oz_eq',  35, 1, 'Highest priority — poultry, fish, beans, eggs, nuts'),
  ('usda_2025', 'dairy',         3.0, 3.0, 'cup_eq', 15, 2, 'Full-fat preferred — milk, yogurt, cheese'),
  ('usda_2025', 'vegetables',    2.5, 3.0, 'cup_eq', 20, 3, 'Variety of colors, leafy greens'),
  ('usda_2025', 'fruits',        1.5, 2.0, 'cup_eq', 10, 4, 'Whole fruits preferred over juice'),
  ('usda_2025', 'whole_grains',  5.0, 6.0, 'oz_eq',  20, 5, 'Minimize refined grains')
ON CONFLICT DO NOTHING;
