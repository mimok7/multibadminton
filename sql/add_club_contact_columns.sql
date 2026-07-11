-- Add optional club contact fields used by the club management screens.
-- Run this once in the Supabase SQL editor.

BEGIN;

ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS address VARCHAR(255),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS manager_name VARCHAR(100);

COMMENT ON COLUMN public.clubs.address IS 'Club address';
COMMENT ON COLUMN public.clubs.phone IS 'Club contact phone number';
COMMENT ON COLUMN public.clubs.manager_name IS 'Club manager display name';

COMMIT;

SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'clubs'
  AND column_name IN ('address', 'phone', 'manager_name')
ORDER BY column_name;
