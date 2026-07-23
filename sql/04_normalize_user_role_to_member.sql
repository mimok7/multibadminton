-- Normalize legacy role values across profiles and club_members.
-- Run this once in the Supabase SQL editor.
--
-- Role ownership:
--   profiles.role      : global application role (superadmin/member)
--   club_members.role  : role within a specific club
--
-- Canonical values:
--   profiles.role      : superadmin, member
--   club_members.role  : owner, admin, manager, member, guest

BEGIN;

-- Replace legacy constraints first. The previous profiles_role_check commonly
-- allows user/manager/admin but rejects the canonical member value.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_canonical_check;

ALTER TABLE public.club_members
  DROP CONSTRAINT IF EXISTS club_members_role_check;

-- Legacy user labels are normal members, not a separate permission level.
UPDATE public.profiles
SET role = 'member'
WHERE LOWER(TRIM(COALESCE(role, ''))) IN ('user', 'member_user', '일반회원', '일반 사용자', 'owner', 'manager', 'admin');

UPDATE public.profiles
SET role = 'superadmin'
WHERE LOWER(TRIM(COALESCE(role, ''))) IN ('administrator', 'superadmin', '시스템 관리자', '슈퍼관리자');

-- Rename the dedicated global administrator username.
UPDATE public.profiles
SET username = '슈퍼관리자',
    role = 'superadmin'
WHERE TRIM(COALESCE(username, '')) = '관리자';

-- Keep the renamed account canonical when this script is run again.
UPDATE public.profiles
SET role = LOWER(TRIM(role))
WHERE role IS NOT NULL
  AND LOWER(TRIM(role)) IN ('superadmin', 'member');

UPDATE public.profiles
SET role = 'superadmin'
WHERE TRIM(COALESCE(username, '')) = '슈퍼관리자';

UPDATE public.club_members
SET role = 'member'
WHERE LOWER(TRIM(COALESCE(role, ''))) IN ('user', 'member_user', '일반회원', '일반 사용자');

UPDATE public.club_members
SET role = LOWER(TRIM(role))
WHERE role IS NOT NULL
  AND LOWER(TRIM(role)) IN ('owner', 'admin', 'manager', 'member');

-- Prevent new unsupported values while leaving any pre-existing unexpected
-- values visible for the audit query below. NOT VALID avoids blocking this
-- migration if old data contains another legacy value.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_role_canonical_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_canonical_check
      CHECK (role IS NULL OR role IN ('superadmin', 'member'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.club_members'::regclass
      AND conname = 'club_members_role_canonical_check'
  ) THEN
    ALTER TABLE public.club_members
      ADD CONSTRAINT club_members_role_canonical_check
      CHECK (role IS NULL OR role IN ('owner', 'admin', 'manager', 'member', 'guest'))
      NOT VALID;
  END IF;
END $$;

COMMIT;

-- Audit remaining non-canonical values. These rows must be cleaned before
-- VALIDATE CONSTRAINT is run in a later deployment.
SELECT 'profiles' AS table_name, role, COUNT(*) AS row_count
FROM public.profiles
WHERE role IS NOT NULL
  AND role NOT IN ('superadmin', 'member')
GROUP BY role
UNION ALL
SELECT 'club_members', role, COUNT(*)
FROM public.club_members
WHERE role IS NOT NULL
  AND role NOT IN ('owner', 'admin', 'manager', 'member', 'guest')
GROUP BY role
ORDER BY table_name, role;

-- Verify the dedicated global administrator profile.
SELECT id, user_id, username, full_name, role
FROM public.profiles
WHERE TRIM(COALESCE(username, '')) = '슈퍼관리자';
