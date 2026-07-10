-- =============================================================================
-- 대전 배드민턴 클럽 임의 회원 50명 균등 레벨 추가 SQL 스크립트 (수정본)
-- =============================================================================

DO $$
DECLARE
    v_club_id UUID;
    v_user_id UUID;
    -- level_info 테이블을 참조하므로 세부 레벨 코드 사용 (A2, B2, C2, D2, E2, N2)
    v_levels TEXT[] := ARRAY['A2', 'B2', 'C2', 'D2', 'E2', 'N2'];
    v_level TEXT;
    i INTEGER;
    v_username TEXT;
    v_full_name TEXT;
BEGIN
    -- 1. 대전 배드민턴 클럽 존재 여부 확인 및 생성
    SELECT id INTO v_club_id FROM public.clubs WHERE code = 'DAEJEON';
    
    IF v_club_id IS NULL THEN
        INSERT INTO public.clubs (name, code, description)
        VALUES ('대전 배드민턴 클럽', 'DAEJEON', '대전 지역 배드민턴 클럽입니다.')
        RETURNING id INTO v_club_id;
    END IF;

    -- 2. 임의 회원 50명 생성 및 클럽 가입 (레벨 균등 분배)
    FOR i IN 1..50 LOOP
        -- A2, B2, C2, D2, E2, N2 레벨 순차 할당
        v_level := v_levels[(i - 1) % 6 + 1];
        
        v_username := 'dj_member_' || lpad(i::text, 2, '0');
        v_full_name := '대전회원' || lpad(i::text, 2, '0');
        v_user_id := gen_random_uuid();
        
        -- profiles 테이블 삽입
        INSERT INTO public.profiles (id, username, full_name, skill_level, role)
        VALUES (v_user_id, v_username, v_full_name, v_level, 'user')
        ON CONFLICT (username) DO NOTHING;
        
        -- 충돌 시 기존 유저 ID 조회
        IF NOT FOUND THEN
            SELECT id INTO v_user_id FROM public.profiles WHERE username = v_username;
        END IF;

        -- club_members 테이블 등록
        INSERT INTO public.club_members (club_id, user_id, role, status, coin_balance)
        VALUES (v_club_id, v_user_id, 'member', 'active', 30)
        ON CONFLICT (club_id, user_id) DO NOTHING;
    END LOOP;
    
    RAISE NOTICE '대전 배드민턴 클럽(code: DAEJEON)에 50명의 임의 회원이 추가되었습니다.';
END $$;
