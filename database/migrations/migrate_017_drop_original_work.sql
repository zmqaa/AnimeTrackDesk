-- Migration 017: Remove deprecated original_work column from anime table
SET @column_exists := (
	SELECT COUNT(*)
	FROM information_schema.COLUMNS
	WHERE TABLE_SCHEMA = DATABASE()
		AND TABLE_NAME = 'anime'
		AND COLUMN_NAME = 'original_work'
);

SET @drop_sql := IF(
	@column_exists > 0,
	'ALTER TABLE anime DROP COLUMN original_work',
	'SELECT 1'
);

PREPARE drop_stmt FROM @drop_sql;
EXECUTE drop_stmt;
DEALLOCATE PREPARE drop_stmt;