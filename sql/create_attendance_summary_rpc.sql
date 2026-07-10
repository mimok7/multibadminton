-- 사용자별 출석 요약 RPC 함수 생성
-- 이 함수는 `attendances` 테이블에서 사용자별 총 출석 횟수와 최근 30일 이내의 출석 횟수, 그리고 최근 출석일을 집계하여 반환합니다.
-- 프론트엔드에서 테이블 전체를 로드하는 Full Table Scan 성능 병목을 해결하기 위해 만들어졌습니다.

DROP FUNCTION IF EXISTS public.get_attendance_summary();

CREATE OR REPLACE FUNCTION public.get_attendance_summary(p_club_id uuid)
RETURNS TABLE (
  user_id UUID,
  total_count BIGINT,
  last30_count BIGINT,
  last_attended_at DATE
) AS $$
DECLARE
  cutoff_date DATE := CURRENT_DATE - INTERVAL '30 days';
BEGIN
  RETURN QUERY
  SELECT 
    a.user_id,
    COUNT(*) AS total_count,
    COUNT(*) FILTER (WHERE a.attended_at >= cutoff_date) AS last30_count,
    MAX(a.attended_at)::date AS last_attended_at
  FROM attendances a
  WHERE a.status = 'present'
    AND a.club_id = p_club_id
  GROUP BY a.user_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- 권한 부여
REVOKE ALL ON FUNCTION public.get_attendance_summary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_attendance_summary(uuid) TO service_role;

-- 확인을 위한 쿼리
-- SELECT * FROM get_attendance_summary();
