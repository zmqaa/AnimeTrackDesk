-- 为 findAnimeByTitle 查询添加索引，避免全表扫描
-- title 精确查找和 LIKE 前缀匹配
CREATE INDEX idx_anime_title ON anime (title);
CREATE INDEX idx_anime_original_title ON anime (original_title(191));
