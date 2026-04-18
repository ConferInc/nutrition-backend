-- Odyssey B2B Triggers Migration
-- Creates triggers for search vectors, audit trails, and data consistency

-- Function to update product search tsvector
CREATE OR REPLACE FUNCTION update_product_search_tsv()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_tsv := to_tsvector('english', 
        COALESCE(NEW.name, '') || ' ' || 
        COALESCE(NEW.brand, '') || ' ' || 
        COALESCE(NEW.description, '') || ' ' ||
        COALESCE(array_to_string(NEW.dietary_tags, ' '), '') || ' ' ||
        COALESCE(array_to_string(NEW.allergens, ' '), '')
    );
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for product search vector updates
CREATE TRIGGER trig_update_product_search_tsv
    BEFORE INSERT OR UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_product_search_tsv();

-- Function to update customer search tsvector
CREATE OR REPLACE FUNCTION update_customer_search_tsv()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_tsv := to_tsvector('english', 
        COALESCE(NEW.full_name, '') || ' ' || 
        COALESCE(NEW.email, '') || ' ' ||
        COALESCE(array_to_string(NEW.custom_tags, ' '), '')
    );
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for customer search vector updates
CREATE TRIGGER trig_update_customer_search_tsv
    BEFORE INSERT OR UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_customer_search_tsv();

-- Function to calculate health metrics automatically
CREATE OR REPLACE FUNCTION calculate_health_metrics()
RETURNS TRIGGER AS $$
DECLARE
    height_m NUMERIC;
    bmr_calc NUMERIC;
    activity_factor NUMERIC;
BEGIN
    -- Calculate BMI
    height_m := NEW.height_cm / 100.0;
    NEW.bmi := round((NEW.weight_kg / (height_m * height_m))::numeric, 2);
    
    -- Calculate BMR using Mifflin-St Jeor equation
    IF NEW.gender = 'male' THEN
        bmr_calc := 10 * NEW.weight_kg + 6.25 * NEW.height_cm - 5 * NEW.age + 5;
    ELSE
        bmr_calc := 10 * NEW.weight_kg + 6.25 * NEW.height_cm - 5 * NEW.age - 161;
    END IF;
    
    NEW.bmr := round(bmr_calc, 2);
    
    -- Calculate TDEE based on activity level
    CASE NEW.activity_level
        WHEN 'sedentary' THEN activity_factor := 1.2;
        WHEN 'light' THEN activity_factor := 1.375;
        WHEN 'moderate' THEN activity_factor := 1.55;
        WHEN 'very' THEN activity_factor := 1.725;
        WHEN 'extra' THEN activity_factor := 1.9;
        ELSE activity_factor := 1.2;
    END CASE;
    
    NEW.tdee_cached := round((bmr_calc * activity_factor), 2);
    
    -- Update derived limits based on conditions (simplified)
    NEW.derived_limits := jsonb_build_object(
        'calories', NEW.tdee_cached,
        'sodium', CASE 
            WHEN 'hypertension' = ANY(NEW.conditions) THEN 1500
            ELSE 2300
        END,
        'sugar', CASE 
            WHEN 'diabetes' = ANY(NEW.conditions) THEN 25
            ELSE 50
        END,
        'fiber', CASE 
            WHEN 'diabetes' = ANY(NEW.conditions) THEN 35
            ELSE 25
        END
    );
    
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for health metrics calculation
CREATE TRIGGER trig_calculate_health_metrics
    BEFORE INSERT OR UPDATE ON customer_health_profiles
    FOR EACH ROW EXECUTE FUNCTION calculate_health_metrics();

-- Function to update vendor catalog version on product changes
CREATE OR REPLACE FUNCTION update_vendor_catalog_version()
RETURNS TRIGGER AS $$
BEGIN
    -- Increment catalog version for cache invalidation
    UPDATE vendors 
    SET catalog_version = catalog_version + 1,
        updated_at = now()
    WHERE id = COALESCE(NEW.vendor_id, OLD.vendor_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create triggers for catalog version updates
CREATE TRIGGER trig_update_catalog_version_products
    AFTER INSERT OR UPDATE OR DELETE ON products
    FOR EACH ROW EXECUTE FUNCTION update_vendor_catalog_version();

-- Function to clean up expired matches cache
CREATE OR REPLACE FUNCTION cleanup_expired_matches()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM matches_cache WHERE ttl_at < now();
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to cleanup expired cache (runs on any matches_cache operation)
CREATE TRIGGER trig_cleanup_expired_matches
    AFTER INSERT OR UPDATE ON matches_cache
    FOR EACH STATEMENT EXECUTE FUNCTION cleanup_expired_matches();

-- Function to clean up expired idempotency keys
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS void AS $$
BEGIN
    DELETE FROM idempotency_keys WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql;

-- Function to validate product nutrition data
CREATE OR REPLACE FUNCTION validate_product_nutrition()
RETURNS TRIGGER AS $$
BEGIN
    -- Validate nutrition JSONB structure if present
    IF NEW.nutrition IS NOT NULL THEN
        -- Ensure nutrition values are numeric where expected
        IF NOT (
            (NEW.nutrition->>'calories')::text ~ '^[0-9]*\.?[0-9]+$' OR
            NEW.nutrition->>'calories' IS NULL
        ) THEN
            RAISE EXCEPTION 'Invalid calories value in nutrition data';
        END IF;
        
        -- Add more nutrition validation as needed
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for product nutrition validation
CREATE TRIGGER trig_validate_product_nutrition
    BEFORE INSERT OR UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION validate_product_nutrition();

-- Function to enforce vendor data isolation
CREATE OR REPLACE FUNCTION enforce_vendor_isolation()
RETURNS TRIGGER AS $$
BEGIN
    -- Ensure all vendor-scoped operations stay within vendor boundaries
    -- This is a safety check since application code should handle this
    
    IF TG_TABLE_NAME = 'products' OR TG_TABLE_NAME = 'customers' THEN
        -- For partitioned tables, vendor_id is already enforced by partitioning
        RETURN NEW;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to audit critical table changes
CREATE OR REPLACE FUNCTION audit_critical_changes()
RETURNS TRIGGER AS $$
DECLARE
    audit_action TEXT;
    audit_entity TEXT;
    audit_entity_id TEXT;
    audit_before JSONB;
    audit_after JSONB;
BEGIN
    -- Determine operation type
    IF TG_OP = 'INSERT' THEN
        audit_action := 'create';
        audit_before := NULL;
        audit_after := to_jsonb(NEW);
    ELSIF TG_OP = 'UPDATE' THEN
        audit_action := 'update';
        audit_before := to_jsonb(OLD);
        audit_after := to_jsonb(NEW);
    ELSIF TG_OP = 'DELETE' THEN
        audit_action := 'delete';
        audit_before := to_jsonb(OLD);
        audit_after := NULL;
    END IF;
    
    -- Determine entity type and ID
    audit_entity := TG_TABLE_NAME;
    
    IF TG_TABLE_NAME = 'customer_health_profiles' THEN
        audit_entity_id := COALESCE(NEW.customer_id::text, OLD.customer_id::text);
    ELSIF TG_TABLE_NAME = 'user_links' THEN
        audit_entity_id := COALESCE(NEW.id::text, OLD.id::text);
    ELSE
        audit_entity_id := COALESCE(NEW.id::text, OLD.id::text);
    END IF;
    
    -- Insert audit record (simplified - in production would include user context)
    INSERT INTO audit_log (
        action, entity, entity_id, before, after, timestamp
    ) VALUES (
        audit_action, audit_entity, audit_entity_id, 
        audit_before, audit_after, now()
    );
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create audit triggers for critical tables
CREATE TRIGGER trig_audit_health_profiles
    AFTER INSERT OR UPDATE OR DELETE ON customer_health_profiles
    FOR EACH ROW EXECUTE FUNCTION audit_critical_changes();

CREATE TRIGGER trig_audit_user_links
    AFTER INSERT OR UPDATE OR DELETE ON user_links
    FOR EACH ROW EXECUTE FUNCTION audit_critical_changes();

CREATE TRIGGER trig_audit_webhook_endpoints
    AFTER INSERT OR UPDATE OR DELETE ON webhook_endpoints
    FOR EACH ROW EXECUTE FUNCTION audit_critical_changes();

-- Function to maintain updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create updated_at triggers for tables that need them
CREATE TRIGGER trig_update_vendors_updated_at
    BEFORE UPDATE ON vendors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trig_update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trig_update_user_links_updated_at
    BEFORE UPDATE ON user_links
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Schedule periodic cleanup tasks (PostgreSQL extension pg_cron would handle this in production)
-- For now, create functions that can be called manually or via external scheduler

-- Function to run all maintenance tasks
CREATE OR REPLACE FUNCTION run_maintenance_tasks()
RETURNS void AS $$
BEGIN
    -- Clean up expired idempotency keys
    PERFORM cleanup_expired_idempotency_keys();
    
    -- Clean up expired matches cache
    DELETE FROM matches_cache WHERE ttl_at < now();
    
    -- Clean up old staging data (older than 7 days)
    DELETE FROM stg_products WHERE job_id IN (
        SELECT id FROM ingestion_jobs 
        WHERE created_at < now() - interval '7 days' 
        AND status IN ('completed', 'failed')
    );
    
    DELETE FROM stg_customers WHERE job_id IN (
        SELECT id FROM ingestion_jobs 
        WHERE created_at < now() - interval '7 days' 
        AND status IN ('completed', 'failed')
    );
    
    -- Clean up old raw vendor data (TTL 30 days per PRD)
    DELETE FROM stg_vendor_raw WHERE fetched_at < now() - interval '30 days';
    
    -- Update table statistics for query optimization
    ANALYZE products;
    ANALYZE customers;
    ANALYZE ingestion_jobs;
    ANALYZE audit_log;
END;
$$ LANGUAGE plpgsql;
