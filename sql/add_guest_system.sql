-- 게스트 계정 자동 만료 처리
-- Supabase Dashboard > SQL Editor에서 한 번 실행하세요.
-- 기준 시간: 한국 시간(Asia/Seoul) 자정

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE;

-- profiles.role은 전역 권한(superadmin/member)만 저장합니다.
-- 게스트 여부는 profiles.is_guest로, 클럽 내 게스트 권한은
-- club_members.role = 'guest'로 구분합니다.
ALTER TABLE public.club_members
  DROP CONSTRAINT IF EXISTS club_members_role_check;
ALTER TABLE public.club_members
  DROP CONSTRAINT IF EXISTS club_members_role_canonical_check;
ALTER TABLE public.club_members
  ADD CONSTRAINT club_members_role_canonical_check
  CHECK (role IS NULL OR role IN ('owner', 'admin', 'manager', 'member', 'guest'))
  NOT VALID;

-- 기존 버전의 함수(void 반환형)와 작업을 정리한 뒤 새 함수로 교체합니다.
DO $$
DECLARE
  existing_job_id BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR existing_job_id IN
      SELECT jobid
      FROM cron.job
      WHERE jobname IN ('delete-guests-midnight', 'delete-expired-guests-kst')
    LOOP
      PERFORM cron.unschedule(existing_job_id);
    END LOOP;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.delete_expired_guests();

-- 게스트가 참가한 마지막 경기일이 지난 경우, 다음 날 00:00에 삭제합니다.
-- 경기 참가 기록이 없는 게스트는 생성일 다음 날 00:00에 삭제합니다.
CREATE OR REPLACE FUNCTION public.delete_expired_guests()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
SET row_security = off
AS $$
DECLARE
  guest_record RECORD;
  deleted_count INTEGER := 0;
  korea_today DATE := (NOW() AT TIME ZONE 'Asia/Seoul')::DATE;
BEGIN
  FOR guest_record IN
    SELECT
      p.id AS profile_id,
      p.user_id AS auth_user_id,
      COALESCE(MAX(ms.match_date), (p.created_at AT TIME ZONE 'Asia/Seoul')::DATE) AS expires_after_date
    FROM public.profiles p
    LEFT JOIN public.match_participants mp ON mp.user_id = p.id
    LEFT JOIN public.match_schedules ms ON ms.id = mp.match_schedule_id
    WHERE p.is_guest = TRUE
    GROUP BY p.id, p.user_id, p.created_at
    HAVING COALESCE(MAX(ms.match_date), (p.created_at AT TIME ZONE 'Asia/Seoul')::DATE) < korea_today
  LOOP
    -- 로그인 가능한 게스트는 auth.users 삭제가 profiles 및 참가 기록을 함께 정리합니다.
    IF guest_record.auth_user_id IS NOT NULL THEN
      DELETE FROM auth.users WHERE id = guest_record.auth_user_id;
    ELSE
      -- 이전 방식으로 만들어진 로그인 없는 게스트도 정리합니다.
      DELETE FROM public.profiles WHERE id = guest_record.profile_id;
    END IF;
    deleted_count := deleted_count + 1;
  END LOOP;

  RETURN deleted_count;
END;
$$;

-- pg_cron은 UTC 기준이므로 매일 15:00 UTC = 한국 시간 다음 날 00:00에 실행합니다.
DO $$
DECLARE
  existing_job_id BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO existing_job_id
    FROM cron.job
    WHERE jobname = 'delete-expired-guests-kst'
    LIMIT 1;

    IF existing_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(existing_job_id);
    END IF;

    PERFORM cron.schedule(
      'delete-expired-guests-kst',
      '0 15 * * *',
      'SELECT public.delete_expired_guests();'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_expired_guests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_expired_guests() TO service_role;
