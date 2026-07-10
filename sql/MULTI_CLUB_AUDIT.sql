-- 멀티클럽/RLS/인덱스 읽기 전용 감사 쿼리
-- 데이터는 변경하지 않습니다.

-- 1. club_id가 있는 public 테이블의 RLS 상태
SELECT
  c.table_name,
  COALESCE(pc.relrowsecurity, false) AS rls_enabled,
  COALESCE(pc.relforcerowsecurity, false) AS rls_forced
FROM information_schema.columns c
JOIN pg_class pc ON pc.oid = to_regclass(format('public.%I', c.table_name))
WHERE c.table_schema = 'public'
  AND c.column_name = 'club_id'
ORDER BY c.table_name;

-- 2. 멀티클럽 제한 정책 확인
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname IN (
    'tenant_isolation', 'tenant_deny_anon',
    'tenant_profile_isolation', 'tenant_profile_deny_anon'
  )
ORDER BY tablename, policyname;

-- 3. 주요 테이블의 club_id NULL 데이터 확인. 모든 값이 0이어야 합니다.
SELECT 'club_members' AS table_name, COUNT(*) AS null_club_rows FROM public.club_members WHERE club_id IS NULL
UNION ALL SELECT 'match_schedules', COUNT(*) FROM public.match_schedules WHERE club_id IS NULL
UNION ALL SELECT 'generated_matches', COUNT(*) FROM public.generated_matches WHERE club_id IS NULL
UNION ALL SELECT 'match_participants', COUNT(*) FROM public.match_participants WHERE club_id IS NULL
UNION ALL SELECT 'attendances', COUNT(*) FROM public.attendances WHERE club_id IS NULL
UNION ALL SELECT 'notifications', COUNT(*) FROM public.notifications WHERE club_id IS NULL
UNION ALL SELECT 'tournaments', COUNT(*) FROM public.tournaments WHERE club_id IS NULL
UNION ALL SELECT 'tournament_matches', COUNT(*) FROM public.tournament_matches WHERE club_id IS NULL;

-- 4. 부모/자식 데이터의 클럽 불일치 확인. 모든 값이 0이어야 합니다.
SELECT 'schedule_generated_match' AS relation_name, COUNT(*) AS mismatched_rows
FROM public.match_schedules s
JOIN public.generated_matches gm ON gm.id = s.generated_match_id
WHERE s.club_id IS DISTINCT FROM gm.club_id
UNION ALL
SELECT 'participant_schedule', COUNT(*)
FROM public.match_participants mp
JOIN public.match_schedules s ON s.id = mp.match_schedule_id
WHERE mp.club_id IS DISTINCT FROM s.club_id
UNION ALL
SELECT 'result_generated_match', COUNT(*)
FROM public.match_results mr
JOIN public.generated_matches gm ON gm.id = mr.match_id
WHERE mr.club_id IS DISTINCT FROM gm.club_id
UNION ALL
SELECT 'tournament_match_tournament', COUNT(*)
FROM public.tournament_matches tm
JOIN public.tournaments t ON t.id = tm.tournament_id
WHERE tm.club_id IS DISTINCT FROM t.club_id
UNION ALL
SELECT 'purchase_product', COUNT(*)
FROM public.product_purchases pp
JOIN public.products p ON p.id = pp.product_id
WHERE pp.club_id IS DISTINCT FROM p.club_id
UNION ALL
SELECT 'survey_response_survey', COUNT(*)
FROM public.survey_responses sr
JOIN public.surveys s ON s.id = sr.survey_id
WHERE sr.club_id IS DISTINCT FROM s.club_id;

-- 5. 외래키 컬럼 중 인덱스가 전혀 없는 항목
SELECT DISTINCT
  conrelid::regclass AS table_name,
  a.attname AS fk_column
FROM pg_constraint c
JOIN pg_attribute a
  ON a.attrelid = c.conrelid
 AND a.attnum = ANY(c.conkey)
WHERE c.contype = 'f'
  AND c.connamespace = 'public'::regnamespace
  AND NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = c.conrelid
      AND a.attnum = ANY(i.indkey)
  )
ORDER BY 1, 2;

-- 6. SECURITY DEFINER 함수의 PUBLIC/anon 실행 권한 확인. 결과가 없어야 합니다.
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  COALESCE(r.rolname, 'PUBLIC') AS granted_to
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl ON true
LEFT JOIN pg_roles r ON r.oid = acl.grantee
WHERE p.prosecdef
  AND n.nspname IN ('public', 'private')
  AND acl.privilege_type = 'EXECUTE'
  AND (acl.grantee = 0 OR r.rolname = 'anon')
ORDER BY 1, 2, 3, 4;
