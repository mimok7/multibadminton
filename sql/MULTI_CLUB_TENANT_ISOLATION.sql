-- 멀티클럽 데이터 격리 최종 방어선
-- 기존 허용 정책을 유지하면서 RESTRICTIVE 정책으로 모든 접근에 클럽 가입 조건을 강제한다.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.current_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.id
  FROM public.profiles p
  WHERE p.id = (SELECT auth.uid())
     OR p.user_id = (SELECT auth.uid())
  ORDER BY CASE WHEN p.user_id = (SELECT auth.uid()) THEN 0 ELSE 1 END
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.current_profile_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_profile_id() TO authenticated;

CREATE OR REPLACE FUNCTION private.is_active_club_member(target_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.club_members cm
      WHERE cm.club_id = target_club_id
        AND cm.user_id = (SELECT private.current_profile_id())
        AND cm.status = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (SELECT private.current_profile_id())
        AND lower(COALESCE(p.role, '')) IN ('admin', 'administrator', '관리자')
    );
$$;

REVOKE ALL ON FUNCTION private.is_active_club_member(uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_active_club_member(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.requested_club_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN COALESCE(NULLIF(current_setting('request.headers', true), ''), '{}')::json ->> 'x-club-id'
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN (COALESCE(NULLIF(current_setting('request.headers', true), ''), '{}')::json ->> 'x-club-id')::uuid
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION private.requested_club_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.requested_club_id() TO authenticated;

DO $migration$
DECLARE
  v_table_name text;
  tenant_tables constant text[] := ARRAY[
    'match_schedules', 'generated_matches', 'attendances', 'team_assignments',
    'match_coin_bets', 'notifications', 'tournament_matches',
    'profile_coin_transactions', 'club_level_aliases', 'match_sessions',
    'match_participants', 'match_results', 'match_player_status',
    'recurring_match_templates', 'tournaments', 'courts', 'products',
    'product_purchases', 'surveys', 'survey_responses', 'challenge_requests',
    'member_level_votes', 'member_rating_settings', 'match_wager_proposals'
  ];
BEGIN
  FOREACH v_table_name IN ARRAY tenant_tables LOOP
    IF to_regclass(format('public.%I', v_table_name)) IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM information_schema.columns c
         WHERE c.table_schema = 'public'
           AND c.table_name = v_table_name
           AND c.column_name = 'club_id'
       ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table_name);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table_name);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', v_table_name);
      EXECUTE format('DROP POLICY IF EXISTS tenant_deny_anon ON public.%I', v_table_name);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        'USING ((SELECT private.is_active_club_member(club_id))) '
        'WITH CHECK ((SELECT private.is_active_club_member(club_id)))',
        v_table_name
      );
      EXECUTE format(
        'CREATE POLICY tenant_deny_anon ON public.%I AS RESTRICTIVE FOR ALL TO anon '
        'USING (false) WITH CHECK (false)',
        v_table_name
      );
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (club_id)',
        'idx_' || v_table_name || '_club_id', v_table_name);
    END IF;
  END LOOP;
END
$migration$;

-- 클럽 가입 정보 자체도 본인의 행 또는 같은 클럽의 활성 회원에게만 노출한다.
ALTER TABLE public.club_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.club_members;
DROP POLICY IF EXISTS tenant_deny_anon ON public.club_members;
CREATE POLICY tenant_isolation
ON public.club_members
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  user_id = (SELECT private.current_profile_id())
  OR (SELECT private.is_active_club_member(club_id))
)
WITH CHECK ((SELECT private.is_active_club_member(club_id)));
CREATE POLICY tenant_deny_anon
ON public.club_members
AS RESTRICTIVE
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_club_members_user_club_status
ON public.club_members (user_id, club_id, status);

-- 출석 중복 기준도 클럽을 포함해야 같은 사용자가 같은 날 여러 클럽에서 출석할 수 있습니다.
ALTER TABLE public.attendances
DROP CONSTRAINT IF EXISTS attendances_user_id_attended_at_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendances_club_user_date
ON public.attendances (club_id, user_id, attended_at);

-- profiles에는 club_id가 없으므로 요청 헤더의 활성 클럽과 club_members를 연결해 제한합니다.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_profile_isolation ON public.profiles;
DROP POLICY IF EXISTS tenant_profile_deny_anon ON public.profiles;
CREATE POLICY tenant_profile_isolation
ON public.profiles
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  id = (SELECT private.current_profile_id())
  OR (
    (SELECT private.requested_club_id()) IS NOT NULL
    AND (SELECT private.is_active_club_member((SELECT private.requested_club_id())))
    AND EXISTS (
      SELECT 1
      FROM public.club_members target_membership
      WHERE target_membership.club_id = (SELECT private.requested_club_id())
        AND target_membership.user_id = profiles.id
        AND target_membership.status = 'active'
    )
  )
)
WITH CHECK (
  id = (SELECT private.current_profile_id())
  OR (
    (SELECT private.requested_club_id()) IS NOT NULL
    AND (SELECT private.is_active_club_member((SELECT private.requested_club_id())))
    AND EXISTS (
      SELECT 1
      FROM public.club_members target_membership
      WHERE target_membership.club_id = (SELECT private.requested_club_id())
        AND target_membership.user_id = profiles.id
        AND target_membership.status = 'active'
    )
  )
);
CREATE POLICY tenant_profile_deny_anon
ON public.profiles
AS RESTRICTIVE
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

-- 기존 무인자 SECURITY DEFINER 집계는 모든 클럽 데이터를 섞으므로 클럽 인자를 강제합니다.
DROP FUNCTION IF EXISTS public.get_attendance_summary();
CREATE OR REPLACE FUNCTION public.get_attendance_summary(p_club_id uuid)
RETURNS TABLE (
  user_id uuid,
  total_count bigint,
  last30_count bigint,
  last_attended_at date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT
    a.user_id,
    COUNT(*) AS total_count,
    COUNT(*) FILTER (WHERE a.attended_at >= CURRENT_DATE - INTERVAL '30 days') AS last30_count,
    MAX(a.attended_at)::date AS last_attended_at
  FROM public.attendances a
  WHERE a.club_id = p_club_id
    AND a.status = 'present'
  GROUP BY a.user_id;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_summary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_attendance_summary(uuid) TO service_role;

-- 관리자 사용자 목록 RPC를 호출자 본인의 실제 프로필 역할로 검증합니다.
-- RETURNS TABLE의 OUT 컬럼이 기존 정의와 다를 수 있어 반드시 삭제 후 재생성합니다.
DROP FUNCTION IF EXISTS public.get_all_users();
CREATE OR REPLACE FUNCTION public.get_all_users()
RETURNS TABLE(
  id uuid,
  email text,
  username text,
  full_name text,
  role text,
  skill_level text,
  skill_label text,
  gender text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT private.current_profile_id())
      AND lower(COALESCE(p.role, '')) IN ('admin', 'administrator', '관리자')
  ) THEN
    RAISE EXCEPTION 'Access denied: Admin role required';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(p.user_id, au.id) AS id,
    au.email::text,
    p.username,
    p.full_name,
    COALESCE(p.role, 'user'::text),
    COALESCE(p.skill_level, 'E2'::text),
    COALESCE(li.name, p.skill_level, 'E2급'::text),
    p.gender,
    COALESCE(au.created_at, p.updated_at)
  FROM public.profiles p
  LEFT JOIN auth.users au ON p.user_id = au.id
  LEFT JOIN public.level_info li ON p.skill_level = li.code
  ORDER BY COALESCE(au.created_at, p.updated_at) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_all_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_all_users() TO authenticated;

-- 서비스 작업용 고권한 함수는 Data API 일반 사용자에게 공개하지 않습니다.
DO $privileges$
BEGIN
  IF to_regprocedure('public.archive_expired_brackets()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.archive_expired_brackets() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.archive_expired_brackets() TO service_role;
  END IF;
  IF to_regprocedure('public.delete_expired_guests()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.delete_expired_guests() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.delete_expired_guests() TO service_role;
  END IF;
  IF to_regprocedure('public.record_match_result_with_coins(bigint,boolean,integer,integer,uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.record_match_result_with_coins(bigint, boolean, integer, integer, uuid)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.record_match_result_with_coins(bigint, boolean, integer, integer, uuid)
      TO service_role;
  END IF;
END
$privileges$;

COMMIT;

-- 적용 후 교차 클럽 노출 여부 점검용 쿼리
-- SELECT club_id, count(*) FROM public.match_schedules GROUP BY club_id;
