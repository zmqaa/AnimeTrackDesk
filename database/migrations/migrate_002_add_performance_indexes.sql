
-- Performance optimization: Adding indexes to frequently queried columns

-- Anime table
ALTER TABLE anime ADD INDEX idx_anime_status (status);
ALTER TABLE anime ADD INDEX idx_anime_updatedAt (updatedAt);

-- Watch History table
ALTER TABLE watch_history ADD INDEX idx_watch_history_animeId (animeId);
ALTER TABLE watch_history ADD INDEX idx_watch_history_watchedAt (watchedAt);

-- Users table
ALTER TABLE users ADD INDEX idx_users_role (role);
