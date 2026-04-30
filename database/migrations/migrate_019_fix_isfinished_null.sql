-- Fix isFinished: change DEFAULT from 0 to NULL, reset false-positive 0 values to NULL
-- Previously all records were created with isFinished=0 even when the value was unknown

ALTER TABLE anime ALTER COLUMN isFinished SET DEFAULT NULL;

UPDATE anime SET isFinished = NULL WHERE isFinished = 0;
