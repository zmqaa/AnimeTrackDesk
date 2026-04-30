-- Migration 011: Add missing credit columns to anime table
ALTER TABLE anime
ADD COLUMN IF NOT EXISTS cast JSON AFTER premiere_date;
