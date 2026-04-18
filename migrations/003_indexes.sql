-- Odyssey B2B Indexes Migration
-- Creates all necessary indexes for performance

-- Products table indexes
CREATE INDEX CONCURRENTLY idx_products_vendor_id ON products (vendor_id);
CREATE INDEX CONCURRENTLY idx_products_status ON products (status);
CREATE INDEX CONCURRENTLY idx_products_updated_at ON products (updated_at DESC);
CREATE INDEX CONCURRENTLY idx_products_brand ON products (brand) WHERE brand IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_products_category_id ON products (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_products_price ON products (price) WHERE price IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_products_soft_deleted ON products (soft_deleted_at) WHERE soft_deleted_at IS NULL;

-- GIN indexes for full-text search and arrays
CREATE INDEX CONCURRENTLY idx_products_search_tsv ON products USING GIN (search_tsv);
CREATE INDEX CONCURRENTLY idx_products_dietary_tags ON products USING GIN (dietary_tags) WHERE dietary_tags IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_products_allergens ON products USING GIN (allergens) WHERE allergens IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_products_certifications ON products USING GIN (certifications) WHERE certifications IS NOT NULL;

-- Composite indexes for common query patterns
CREATE INDEX CONCURRENTLY idx_products_vendor_status_updated ON products (vendor_id, status, updated_at DESC);
CREATE INDEX CONCURRENTLY idx_products_vendor_brand_status ON products (vendor_id, brand, status) WHERE brand IS NOT NULL;

-- Customers table indexes
CREATE INDEX CONCURRENTLY idx_customers_vendor_id ON customers (vendor_id);
CREATE INDEX CONCURRENTLY idx_customers_updated_at ON customers (updated_at DESC);
CREATE INDEX CONCURRENTLY idx_customers_email ON customers (email);
CREATE INDEX CONCURRENTLY idx_customers_search_tsv ON customers USING GIN (search_tsv) WHERE search_tsv IS NOT NULL;

-- Composite indexes for customers
CREATE INDEX CONCURRENTLY idx_customers_vendor_updated ON customers (vendor_id, updated_at DESC);
CREATE INDEX CONCURRENTLY idx_customers_vendor_email ON customers (vendor_id, email);

-- Customer health profiles indexes
CREATE INDEX CONCURRENTLY idx_customer_health_customer_vendor ON customer_health_profiles (customer_id, vendor_id);
CREATE INDEX CONCURRENTLY idx_customer_health_conditions ON customer_health_profiles USING GIN (conditions) WHERE conditions != '{}';
CREATE INDEX CONCURRENTLY idx_customer_health_allergens ON customer_health_profiles USING GIN (avoid_allergens) WHERE avoid_allergens != '{}';

-- Ingestion jobs indexes
CREATE INDEX CONCURRENTLY idx_ingestion_jobs_vendor_id ON ingestion_jobs (vendor_id);
CREATE INDEX CONCURRENTLY idx_ingestion_jobs_status ON ingestion_jobs (status);
CREATE INDEX CONCURRENTLY idx_ingestion_jobs_created_at ON ingestion_jobs (created_at DESC);
CREATE INDEX CONCURRENTLY idx_ingestion_jobs_vendor_status ON ingestion_jobs (vendor_id, status, created_at DESC);

-- Composite index for queue processing
CREATE INDEX CONCURRENTLY idx_ingestion_jobs_queue ON ingestion_jobs (status, vendor_id, created_at) WHERE status = 'queued';

-- Ingestion job errors indexes
CREATE INDEX CONCURRENTLY idx_job_errors_job_id ON ingestion_job_errors (job_id);
CREATE INDEX CONCURRENTLY idx_job_errors_code ON ingestion_job_errors (code);

-- Audit log indexes (critical for HIPAA compliance)
CREATE INDEX CONCURRENTLY idx_audit_log_timestamp ON audit_log (timestamp DESC);
CREATE INDEX CONCURRENTLY idx_audit_log_vendor_id ON audit_log (vendor_id, timestamp DESC) WHERE vendor_id IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_audit_log_actor ON audit_log (actor_user_id, timestamp DESC) WHERE actor_user_id IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_audit_log_entity ON audit_log (entity, entity_id, timestamp DESC);
CREATE INDEX CONCURRENTLY idx_audit_log_health_access ON audit_log (entity, vendor_id, timestamp DESC) WHERE entity = 'customer_health_profile';

-- Webhook tables indexes
CREATE INDEX CONCURRENTLY idx_webhook_endpoints_vendor ON webhook_endpoints (vendor_id, enabled);
CREATE INDEX CONCURRENTLY idx_webhook_deliveries_endpoint ON webhook_deliveries (endpoint_id, timestamp DESC);
CREATE INDEX CONCURRENTLY idx_webhook_deliveries_status ON webhook_deliveries (status, timestamp);
CREATE INDEX CONCURRENTLY idx_webhook_deliveries_retry ON webhook_deliveries (status, attempt) WHERE status = 'retry';

-- Idempotency keys indexes
CREATE INDEX CONCURRENTLY idx_idempotency_vendor_key ON idempotency_keys (vendor_id, key);
CREATE INDEX CONCURRENTLY idx_idempotency_expires_at ON idempotency_keys (expires_at);

-- Staging tables indexes (lightweight for bulk operations)
CREATE INDEX CONCURRENTLY idx_stg_products_job_id ON stg_products (job_id);
CREATE INDEX CONCURRENTLY idx_stg_products_vendor_external ON stg_products (vendor_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_stg_customers_job_id ON stg_customers (job_id);
CREATE INDEX CONCURRENTLY idx_stg_customers_vendor_external ON stg_customers (vendor_id, external_id) WHERE external_id IS NOT NULL;

-- Connector tables indexes
CREATE INDEX CONCURRENTLY idx_connectors_vendor_source ON connectors (vendor_id, source);
CREATE INDEX CONCURRENTLY idx_connectors_enabled ON connectors (vendor_id, enabled) WHERE enabled = true;
CREATE INDEX CONCURRENTLY idx_connector_cursors_vendor_source ON connector_cursors (vendor_id, source);

-- Matches cache indexes
CREATE INDEX CONCURRENTLY idx_matches_cache_ttl ON matches_cache (ttl_at);
CREATE INDEX CONCURRENTLY idx_matches_cache_customer ON matches_cache (customer_id, vendor_id);

-- Taxonomy tables indexes
CREATE INDEX CONCURRENTLY idx_tax_categories_code ON tax_categories (code);
CREATE INDEX CONCURRENTLY idx_tax_categories_active ON tax_categories (active) WHERE active = true;
CREATE INDEX CONCURRENTLY idx_tax_tags_code ON tax_tags (code);
CREATE INDEX CONCURRENTLY idx_tax_tags_active ON tax_tags (active) WHERE active = true;
CREATE INDEX CONCURRENTLY idx_tax_allergens_code ON tax_allergens (code);
CREATE INDEX CONCURRENTLY idx_tax_allergens_active ON tax_allergens (active) WHERE active = true;

-- Synonym tables indexes
CREATE INDEX CONCURRENTLY idx_synonyms_header_canonical ON synonyms_header (canonical);
CREATE INDEX CONCURRENTLY idx_synonyms_value_domain ON synonyms_value (domain, canonical);

-- User management indexes
CREATE INDEX CONCURRENTLY idx_user_links_user_id ON user_links (user_id);
CREATE INDEX CONCURRENTLY idx_user_links_vendor_id ON user_links (vendor_id);
CREATE INDEX CONCURRENTLY idx_user_links_role ON user_links (role, vendor_id);

-- Vendor mappings indexes
CREATE INDEX CONCURRENTLY idx_vendor_mappings_vendor_mode ON vendor_mappings (vendor_id, mode);

-- Diet rules and scoring policies indexes
CREATE INDEX CONCURRENTLY idx_diet_rules_vendor_condition ON diet_rules (vendor_id, condition_code, active) WHERE active = true;
CREATE INDEX CONCURRENTLY idx_scoring_policies_vendor_active ON scoring_policies (vendor_id, active) WHERE active = true;

-- Partial indexes for active records (performance optimization)
CREATE INDEX CONCURRENTLY idx_products_active_vendor ON products (vendor_id, updated_at DESC) WHERE status = 'active' AND soft_deleted_at IS NULL;
CREATE INDEX CONCURRENTLY idx_customers_active_vendor ON customers (vendor_id, updated_at DESC);

-- Text search optimization indexes (trigram)
CREATE INDEX CONCURRENTLY idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_products_brand_trgm ON products USING GIN (brand gin_trgm_ops) WHERE brand IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_customers_name_trgm ON customers USING GIN (full_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_customers_email_trgm ON customers USING GIN (email gin_trgm_ops);
