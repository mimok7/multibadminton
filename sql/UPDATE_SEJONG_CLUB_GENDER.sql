-- =============================================================================
-- 세종 배드민턴 클럽 회원 성별 반반(50% 남성, 50% 여성) 지정 SQL
-- 조건: 세종 배드민턴 클럽 회원들의 성별(gender: 'M', 'F')을 정확히 50대 50 비율로 무작위 배분합니다.
-- =============================================================================

BEGIN;

WITH club_target AS (
    -- '세종'이 포함된 클럽을 찾습니다
    SELECT id FROM clubs WHERE name LIKE '%세종%' LIMIT 1
),
ranked_members AS (
    SELECT 
        p.id as profile_id,
        -- 회원을 무작위로 2개의 그룹(bucket 1, 2)으로 균등 분할합니다.
        NTILE(2) OVER (ORDER BY random()) as bucket
    FROM profiles p
    JOIN club_members cm ON p.id = cm.user_id
    WHERE cm.club_id = (SELECT id FROM club_target)
)
UPDATE profiles
SET gender = CASE 
    WHEN r.bucket = 1 THEN 'M'  -- 남성
    ELSE 'F'                    -- 여성
END
FROM ranked_members r
WHERE profiles.id = r.profile_id;

-- =============================================================================
-- 검증용 조회 쿼리 (업데이트 후 성별 분포 확인)
-- =============================================================================
SELECT 
    COALESCE(p.gender, '미지정') as gender,
    COUNT(*) as member_count,
    ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 2) as percentage
FROM profiles p
JOIN club_members cm ON p.id = cm.user_id
JOIN clubs c ON cm.club_id = c.id
WHERE c.name LIKE '%세종%'
GROUP BY 1
ORDER BY 1;

COMMIT;
