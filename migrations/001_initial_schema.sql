-- Odyssey B2B Initial Schema Migration
-- This creates the base tables without partitioning

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create enums
CREATE TYPE user_role AS ENUM ('superadmin', 'vendor_admin', 'vendor_operator', 'vendor_viewer');
CREATE TYPE vendor_status AS ENUM ('active', 'inactive', 'suspended');
CREATE TYPE product_status AS ENUM ('active', 'inactive');
CREATE TYPE customer_gender AS ENUM ('male', 'female', 'other', 'unspecified');
CREATE TYPE activity_level AS ENUM ('sedentary', 'light', 'moderate', 'very', 'extra');
CREATE TYPE job_status AS ENUM ('queued', 'running', 'failed', 'completed', 'canceled');
CREATE TYPE job_mode AS ENUM ('products', 'customers', 'api_sync');
CREATE TYPE source AS ENUM ('csv', 'api');
CREATE TYPE gtin_type AS ENUM ('UPC', 'EAN', 'ISBN');
CREATE TYPE auth_type AS ENUM ('api_key', 'oauth2', 'basic');
CREATE TYPE synonym_domain AS ENUM ('allergen', 'condition', 'unit', 'diet', 'gender', 'activity');
CREATE TYPE consent_type AS ENUM ('data_processing', 'health_data', 'marketing');
CREATE TYPE webhook_event AS ENUM ('job.completed', 'job.failed', 'product.updated', 'customer.updated');
CREATE TYPE delivery_status AS ENUM ('pending', 'delivered', 'failed', 'retry');

-- Core tables
CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    status vendor_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    settings_json JSONB DEFAULT '{}',
    catalog_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE user_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    role user_role NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE(user_id, vendor_id)
);

CREATE TABLE platform_admins (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id)
);

-- Products table (will be partitioned in next migration)
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    external_id TEXT NOT NULL,
    name TEXT NOT NULL,
    brand TEXT,
    description TEXT,
    category_id UUID,
    price NUMERIC(12,2),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    status product_status NOT NULL DEFAULT 'active',
    search_tsv TSVECTOR,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    -- Optional fields
    barcode TEXT,
    gtin_type gtin_type,
    ingredients TEXT,
    sub_category_id UUID,
    cuisine_id UUID,
    market_id UUID,
    nutrition JSONB,
    serving_size TEXT,
    package_weight TEXT,
    dietary_tags TEXT[],
    allergens TEXT[],
    certifications TEXT[],
    regulatory_codes TEXT[],
    source_url TEXT,
    soft_deleted_at TIMESTAMP,
    UNIQUE(vendor_id, external_id),
    UNIQUE(vendor_id, barcode)
);

CREATE TABLE product_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id),
    url TEXT NOT NULL,
    alt TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE product_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id),
    source source NOT NULL,
    source_ref TEXT,
    ingestion_job_id UUID,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Customers table (will be partitioned in next migration)
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    external_id TEXT NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    dob TIMESTAMP,
    age INTEGER,
    gender customer_gender,
    location JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    -- Optional fields
    phone TEXT,
    custom_tags TEXT[],
    search_tsv TSVECTOR,
    created_by UUID,
    updated_by UUID,
    UNIQUE(vendor_id, external_id)
);

CREATE TABLE customer_health_profiles (
    customer_id UUID PRIMARY KEY REFERENCES customers(id),
    height_cm NUMERIC(5,2) NOT NULL,
    weight_kg NUMERIC(6,2) NOT NULL,
    age INTEGER NOT NULL,
    gender customer_gender NOT NULL,
    activity_level activity_level NOT NULL,
    conditions TEXT[] NOT NULL DEFAULT '{}',
    diet_goals TEXT[] NOT NULL DEFAULT '{}',
    macro_targets JSONB NOT NULL DEFAULT '{}',
    avoid_allergens TEXT[] NOT NULL DEFAULT '{}',
    -- Derived fields
    bmi NUMERIC(5,2),
    bmr NUMERIC(8,2),
    tdee_cached NUMERIC(8,2),
    derived_limits JSONB DEFAULT '{}',
    -- Audit fields
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID
);

CREATE TABLE customer_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    consent_type consent_type NOT NULL,
    granted BOOLEAN NOT NULL,
    version TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE customer_whitelists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    product_id UUID NOT NULL REFERENCES products(id),
    note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE customer_blacklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    product_id UUID NOT NULL REFERENCES products(id),
    note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Taxonomy tables
CREATE TABLE tax_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    parent_id UUID REFERENCES tax_categories(id),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE tax_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    parent_id UUID REFERENCES tax_tags(id),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE tax_allergens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    parent_id UUID REFERENCES tax_allergens(id),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE tax_cuisines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    parent_id UUID REFERENCES tax_cuisines(id),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE tax_certifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    parent_id UUID REFERENCES tax_certifications(id),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Synonym tables
CREATE TABLE synonyms_header (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical TEXT NOT NULL,
    synonyms TEXT[] NOT NULL,
    transform_ops JSONB DEFAULT '{}',
    confidence NUMERIC(3,2) NOT NULL DEFAULT 1.0
);

CREATE TABLE synonyms_value (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain synonym_domain NOT NULL,
    canonical TEXT NOT NULL,
    synonyms TEXT[] NOT NULL
);

CREATE TABLE vendor_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    mode job_mode NOT NULL,
    map JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Ingestion tables
CREATE TABLE ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    mode job_mode NOT NULL,
    status job_status NOT NULL DEFAULT 'queued',
    progress_pct INTEGER NOT NULL DEFAULT 0,
    totals JSONB DEFAULT '{}',
    error_url TEXT,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    attempt INTEGER NOT NULL DEFAULT 1,
    params JSONB DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE ingestion_job_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES ingestion_jobs(id),
    row_no INTEGER NOT NULL,
    field TEXT,
    code TEXT NOT NULL,
    message TEXT NOT NULL,
    raw JSONB
);

-- Staging tables
CREATE TABLE stg_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL,
    vendor_id UUID NOT NULL,
    external_id TEXT,
    name TEXT,
    brand TEXT,
    description TEXT,
    category_id TEXT,
    price TEXT,
    currency TEXT,
    barcode TEXT,
    gtin_type TEXT,
    ingredients TEXT,
    nutrition TEXT,
    serving_size TEXT,
    package_weight TEXT,
    dietary_tags TEXT,
    allergens TEXT,
    certifications TEXT,
    regulatory_codes TEXT,
    source_url TEXT,
    raw_data JSONB
);

CREATE TABLE stg_customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL,
    vendor_id UUID NOT NULL,
    external_id TEXT,
    full_name TEXT,
    email TEXT,
    dob TEXT,
    age TEXT,
    gender TEXT,
    location TEXT,
    phone TEXT,
    custom_tags TEXT,
    raw_data JSONB
);

CREATE TABLE stg_vendor_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    source TEXT NOT NULL,
    page_id TEXT,
    payload JSONB NOT NULL,
    fetched_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Connector tables
CREATE TABLE connectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    source TEXT NOT NULL,
    base_url TEXT NOT NULL,
    auth_type auth_type NOT NULL,
    rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
    secrets_ref TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE connector_cursors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    source TEXT NOT NULL,
    cursor TEXT,
    synced_at TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'pending'
);

-- Cache tables
CREATE TABLE matches_cache (
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    catalog_version INTEGER NOT NULL,
    results JSONB NOT NULL,
    ttl_at TIMESTAMP NOT NULL,
    PRIMARY KEY (vendor_id, customer_id, catalog_version)
);

-- Policy tables
CREATE TABLE diet_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    condition_code TEXT NOT NULL,
    policy JSONB NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE scoring_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    weights JSONB NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Webhook tables
CREATE TABLE webhook_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    url TEXT NOT NULL,
    secret_ref TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    description TEXT,
    retries_max INTEGER NOT NULL DEFAULT 3,
    tolerance_sec INTEGER NOT NULL DEFAULT 300,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id),
    event_type webhook_event NOT NULL,
    payload JSONB NOT NULL,
    status delivery_status NOT NULL DEFAULT 'pending',
    attempt INTEGER NOT NULL DEFAULT 1,
    last_error TEXT,
    signature TEXT,
    timestamp TIMESTAMP NOT NULL DEFAULT now()
);

-- Idempotency table
CREATE TABLE idempotency_keys (
    key TEXT PRIMARY KEY,
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_hash TEXT,
    status TEXT NOT NULL DEFAULT 'processing',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    expires_at TIMESTAMP NOT NULL
);

-- Audit table
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID,
    actor_role TEXT,
    vendor_id UUID REFERENCES vendors(id),
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    before JSONB,
    after JSONB,
    ip TEXT,
    ua TEXT,
    justification TEXT,
    timestamp TIMESTAMP NOT NULL DEFAULT now()
);
