-- Initial schema migration (v1)
-- This is handled by schema.sql; this file exists for future migrations

-- Future migrations should follow this pattern:
-- -- Migration v2: add new_feature_column
-- ALTER TABLE findings ADD COLUMN new_feature TEXT;
-- INSERT INTO schema_migrations (version, name) VALUES (2, 'add_new_feature');
