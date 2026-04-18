-- Odyssey B2B Partitioning Migration
-- Implements LIST partitioning by vendor_id with HASH sub-partitions

-- Drop existing products table and recreate as partitioned
DROP TABLE IF EXISTS product_images;
DROP TABLE IF EXISTS product_sources;
DROP TABLE IF EXISTS products CASCADE;

-- Create partitioned products table
CREATE TABLE products (
    id UUID DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL,
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
    PRIMARY KEY (id, vendor_id),
    UNIQUE(vendor_id, external_id),
    UNIQUE(vendor_id, barcode)
) PARTITION BY LIST (vendor_id);

-- Drop existing customers table and recreate as partitioned
DROP TABLE IF EXISTS customer_health_profiles;
DROP TABLE IF EXISTS customer_consents;
DROP TABLE IF EXISTS customer_whitelists;
DROP TABLE IF EXISTS customer_blacklists;
DROP TABLE IF EXISTS customers CASCADE;

-- Create partitioned customers table
CREATE TABLE customers (
    id UUID DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL,
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
    PRIMARY KEY (id, vendor_id),
    UNIQUE(vendor_id, external_id)
) PARTITION BY LIST (vendor_id);

-- Function to create vendor partitions
CREATE OR REPLACE FUNCTION create_vendor_partitions(vendor_uuid UUID)
RETURNS VOID AS $$
DECLARE
    i INTEGER;
BEGIN
    -- Create products partition with 16 hash sub-partitions
    EXECUTE format('CREATE TABLE products_vendor_%s PARTITION OF products 
        FOR VALUES IN (''%s'') PARTITION BY HASH (id)', 
        replace(vendor_uuid::text, '-', '_'), vendor_uuid);
    
    -- Create 16 hash partitions for products
    FOR i IN 0..15 LOOP
        EXECUTE format('CREATE TABLE products_vendor_%s_%s PARTITION OF products_vendor_%s
            FOR VALUES WITH (modulus 16, remainder %s)',
            replace(vendor_uuid::text, '-', '_'), i,
            replace(vendor_uuid::text, '-', '_'), i);
    END LOOP;
    
    -- Create customers partition with 32 hash sub-partitions
    EXECUTE format('CREATE TABLE customers_vendor_%s PARTITION OF customers 
        FOR VALUES IN (''%s'') PARTITION BY HASH (id)', 
        replace(vendor_uuid::text, '-', '_'), vendor_uuid);
    
    -- Create 32 hash partitions for customers
    FOR i IN 0..31 LOOP
        EXECUTE format('CREATE TABLE customers_vendor_%s_%s PARTITION OF customers_vendor_%s
            FOR VALUES WITH (modulus 32, remainder %s)',
            replace(vendor_uuid::text, '-', '_'), i,
            replace(vendor_uuid::text, '-', '_'), i);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to automatically create partitions for new vendors
CREATE OR REPLACE FUNCTION create_partitions_for_new_vendor()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM create_vendor_partitions(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on vendors table
CREATE TRIGGER trigger_create_vendor_partitions
    AFTER INSERT ON vendors
    FOR EACH ROW
    EXECUTE FUNCTION create_partitions_for_new_vendor();

-- Create partitions for existing vendors (if any)
DO $$
DECLARE
    vendor_record RECORD;
BEGIN
    FOR vendor_record IN SELECT id FROM vendors LOOP
        PERFORM create_vendor_partitions(vendor_record.id);
    END LOOP;
END $$;

-- Recreate dependent tables with proper foreign key references
CREATE TABLE product_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL,
    vendor_id UUID NOT NULL,
    url TEXT NOT NULL,
    alt TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    FOREIGN KEY (product_id, vendor_id) REFERENCES products(id, vendor_id)
);

CREATE TABLE product_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL,
    vendor_id UUID NOT NULL,
    source source NOT NULL,
    source_ref TEXT,
    ingestion_job_id UUID,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    FOREIGN KEY (product_id, vendor_id) REFERENCES products(id, vendor_id)
);

CREATE TABLE customer_health_profiles (
    customer_id UUID NOT NULL,
    vendor_id UUID NOT NULL,
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
    updated_by UUID,
    PRIMARY KEY (customer_id, vendor_id),
    FOREIGN KEY (customer_id, vendor_id) REFERENCES customers(id, vendor_id)
);

CREATE TABLE customer_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL,
    vendor_id UUID NOT NULL,
    consent_type consent_type NOT NULL,
    granted BOOLEAN NOT NULL,
    version TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT now(),
    FOREIGN KEY (customer_id, vendor_id) REFERENCES customers(id, vendor_id)
);

CREATE TABLE customer_whitelists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL,
    product_id UUID NOT NULL,
    vendor_id UUID NOT NULL,
    note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    FOREIGN KEY (customer_id, vendor_id) REFERENCES customers(id, vendor_id),
    FOREIGN KEY (product_id, vendor_id) REFERENCES products(id, vendor_id)
);

CREATE TABLE customer_blacklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL,
    product_id UUID NOT NULL,
    vendor_id UUID NOT NULL,
    note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    FOREIGN KEY (customer_id, vendor_id) REFERENCES customers(id, vendor_id),
    FOREIGN KEY (product_id, vendor_id) REFERENCES products(id, vendor_id)
);

-- Update matches_cache to use composite foreign keys
DROP TABLE IF EXISTS matches_cache;
CREATE TABLE matches_cache (
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    customer_id UUID NOT NULL,
    catalog_version INTEGER NOT NULL,
    results JSONB NOT NULL,
    ttl_at TIMESTAMP NOT NULL,
    PRIMARY KEY (vendor_id, customer_id, catalog_version),
    FOREIGN KEY (customer_id, vendor_id) REFERENCES customers(id, vendor_id)
);
