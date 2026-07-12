-- =============================================================================
-- 세종 배드민턴 클럽 회원 급수 자동 배분 SQL
-- 조건: 중간층 약 50%, 상위 25%, 하위 25%, 성별(M/F) 비율 각각 동일하게 적용
-- 적용 대상 등급 (profiles 테이블의 skill_level check constraint 기준):
--   - 상위(25%): A1, A2, B1
--   - 중간(50%): B2, C1, C2, D1
--   - 하위(25%): D2, E1, E2
-- =============================================================================

BEGIN;

WITH club_target AS (
    -- '세종'이 포함된 클럽을 찾습니다
    SELECT id FROM clubs WHERE name LIKE '%세종%' LIMIT 1
),
ranked_members AS (
    SELECT 
        p.id as profile_id,
        p.gender,
        -- 성별로 나누어 무작위로 4등분 (1: 상위 25%, 2~3: 중간 50%, 4: 하위 25%)
        -- 성별이 NULL인 경우 'M'으로 간주하여 비율을 맞춥니다.
        NTILE(4) OVER (PARTITION BY COALESCE(p.gender, 'M') ORDER BY random()) as bucket
    FROM profiles p
    JOIN club_members cm ON p.id = cm.user_id
    WHERE cm.club_id = (SELECT id FROM club_target)
)
UPDATE profiles
SET skill_level = 
    CASE 
        WHEN r.bucket = 1 THEN 
            -- 상위 티어: A1, A2, B1 중 랜덤 지정
            (ARRAY['A1', 'A2', 'B1'])[floor(random() * 3 + 1)]
        WHEN r.bucket IN (2, 3) THEN 
            -- 중간 티어: B2, C1, C2, D1 중 랜덤 지정
            (ARRAY['B2', 'C1', 'C2', 'D1'])[floor(random() * 4 + 1)]
        WHEN r.bucket = 4 THEN 
            -- 하위 티어: D2, E1, E2 중 랜덤 지정
            (ARRAY['D2', 'E1', 'E2'])[floor(random() * 3 + 1)]
    END
FROM ranked_members r
WHERE profiles.id = r.profile_id;

-- =============================================================================
-- 검증용 조회 쿼리 (업데이트 후 각 티어 및 성별 분포 확인)
-- =============================================================================
SELECT 
    COALESCE(p.gender, '미지정') as gender,
    CASE 
        WHEN p.skill_level IN ('A1', 'A2', 'B1') THEN '1. 상위 (A1~B1)'
        WHEN p.skill_level IN ('B2', 'C1', 'C2', 'D1') THEN '2. 중간 (B2~D1)'
        WHEN p.skill_level IN ('D2', 'E1', 'E2') THEN '3. 하위 (D2~E2)'
        ELSE '4. 기타'
    END as tier,
    COUNT(*) as member_count
FROM profiles p
JOIN club_members cm ON p.id = cm.user_id
JOIN clubs c ON cm.club_id = c.id
WHERE c.name LIKE '%세종%'
GROUP BY 1, 2
ORDER BY 1, 2;

COMMIT;
