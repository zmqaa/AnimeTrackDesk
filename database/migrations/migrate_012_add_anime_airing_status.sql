-- Add isFinished column to anime table
ALTER TABLE anime ADD COLUMN isFinished BOOLEAN DEFAULT FALSE;
