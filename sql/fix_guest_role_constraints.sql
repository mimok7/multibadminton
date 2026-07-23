-- 게스트 생성 시 role 체크 제약조건 오류를 수정합니다.
-- Supabase Dashboard > SQL Editor에서 이 파일 전체를 한 번 실행하세요.
--
-- profiles.role은 전역 권한이므로 게스트도 member를 사용하고,
-- 실제 게스트 구분은 profiles.is_guest와 club_members.role로 처리합니다.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE;

-- 이전 코드가 저장한 프로필 역할을 현재 표준값으로 정리합니다.
UPDATE public.profiles
SET role = 'member'
WHERE LOWER(TRIM(COALESCE(role, ''))) = 'user';

-- 클럽 내 역할에는 guest를 허용합니다.
ALTER TABLE public.club_members
  DROP CONSTRAINT IF EXISTS club_members_role_check;
ALTER TABLE public.club_members
  DROP CONSTRAINT IF EXISTS club_members_role_canonical_check;
ALTER TABLE public.club_members
  ADD CONSTRAINT club_members_role_canonical_check
  CHECK (role IS NULL OR role IN ('owner', 'admin', 'manager', 'member', 'guest'))
  NOT VALID;

COMMIT;

-- 적용 결과 확인: guest가 허용 목록에 표시되어야 합니다.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.club_members'::regclass
  AND conname = 'club_members_role_canonical_check';
