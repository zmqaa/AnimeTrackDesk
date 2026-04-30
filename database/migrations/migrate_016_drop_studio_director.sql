-- Migration 016: Drop low-confidence credit fields from anime metadata
SET @drop_studio_sql = (
	SELECT IF(
		EXISTS(
			SELECT 1
			FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE()
				AND TABLE_NAME = 'anime'
				AND COLUMN_NAME = 'studio'
		),
		'ALTER TABLE anime DROP COLUMN studio',
		'SELECT 1'
	)
);

PREPARE drop_studio_stmt FROM @drop_studio_sql;
EXECUTE drop_studio_stmt;
DEALLOCATE PREPARE drop_studio_stmt;

SET @drop_director_sql = (
	SELECT IF(
		EXISTS(
			SELECT 1
			FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE()
				AND TABLE_NAME = 'anime'
				AND COLUMN_NAME = 'director'
		),
		'ALTER TABLE anime DROP COLUMN director',
		'SELECT 1'
	)
);

PREPARE drop_director_stmt FROM @drop_director_sql;
EXECUTE drop_director_stmt;
DEALLOCATE PREPARE drop_director_stmt;