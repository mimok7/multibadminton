-- 기존 회원 레벨 정규화 및 클럽별 레벨 별칭 초기 입력
--
-- 1) profiles.skill_level을 public.level_info.code 기준으로 정규화합니다.
-- 2) 모든 클럽에 level_info의 모든 레벨 별칭을 입력합니다.
-- 3) 이미 관리자가 지정한 별칭은 덮어쓰지 않습니다.
-- 4) 점수는 profiles에 저장하지 않고 level_info.score를 기준으로 사용합니다.
--
-- 반복 실행해도 기존 별칭과 정상 레벨 데이터는 보존됩니다.

BEGIN;

-- 과거 단일 레벨 코드가 남아 있는 경우 1단계 코드로 통일합니다.
UPDATE public.profiles
SET skill_level = CASE UPPER(TRIM(skill_level))
    WHEN 'A' THEN 'A1'
    WHEN 'B' THEN 'B1'
    WHEN 'C' THEN 'C1'
    WHEN 'D' THEN 'D1'
    WHEN 'E' THEN 'E1'
    WHEN 'N' THEN 'N1'
    ELSE UPPER(TRIM(skill_level))
END
WHERE skill_level IS NOT NULL
  AND (
    skill_level <> UPPER(TRIM(skill_level))
    OR UPPER(TRIM(skill_level)) IN ('A', 'B', 'C', 'D', 'E', 'N')
  );

-- 모든 클럽에 모든 표준 레벨의 기본 별칭을 입력합니다.
-- level_info.description을 기본 별칭으로 사용하고, 없으면 name/code를 사용합니다.
INSERT INTO public.club_level_aliases (club_id, level_code, alias)
SELECT
    c.id,
    li.code,
    COALESCE(NULLIF(TRIM(li.description), ''), NULLIF(TRIM(li.name), ''), li.code)
FROM public.clubs c
CROSS JOIN public.level_info li
WHERE li.code IS NOT NULL
ON CONFLICT (club_id, level_code) DO NOTHING;

-- 표준 레벨에 없는 회원 레벨이 남아 있으면 입력을 확정하지 않습니다.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.profiles p
        LEFT JOIN public.level_info li
          ON li.code = UPPER(TRIM(p.skill_level))
        WHERE p.skill_level IS NOT NULL
          AND li.code IS NULL
    ) THEN
        RAISE EXCEPTION 'profiles.skill_level에 level_info.code와 일치하지 않는 값이 있습니다.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.level_info
        WHERE score IS NULL
    ) THEN
        RAISE EXCEPTION 'level_info.score가 NULL인 레벨이 있습니다.';
    END IF;
END $$;

COMMIT;

-- 결과 확인: 회원 레벨별 인원과 적용 점수
SELECT
    li.code AS level_code,
    li.name AS level_name,
    li.score,
    COUNT(p.id) AS member_count
FROM public.level_info li
LEFT JOIN public.profiles p
  ON UPPER(TRIM(p.skill_level)) = li.code
GROUP BY li.code, li.name, li.score
ORDER BY li.score DESC, li.code;

-- 결과 확인: 클럽별 별칭 누락 여부
SELECT
    c.name AS club_name,
    COUNT(DISTINCT cla.level_code) AS alias_level_count,
    (SELECT COUNT(*) FROM public.level_info) AS standard_level_count
FROM public.clubs c
LEFT JOIN public.club_level_aliases cla ON cla.club_id = c.id
GROUP BY c.id, c.name
ORDER BY c.name;
