SET @cast_aliases_exists = (
	SELECT COUNT(*)
	FROM INFORMATION_SCHEMA.COLUMNS
	WHERE TABLE_SCHEMA = DATABASE()
		AND TABLE_NAME = 'anime'
		AND COLUMN_NAME = 'cast_aliases'
);

SET @cast_aliases_sql = IF(
	@cast_aliases_exists = 0,
	'ALTER TABLE anime ADD COLUMN cast_aliases JSON AFTER cast',
	'SELECT 1'
);

PREPARE cast_aliases_stmt FROM @cast_aliases_sql;
EXECUTE cast_aliases_stmt;
DEALLOCATE PREPARE cast_aliases_stmt;