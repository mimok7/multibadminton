-- 배드민턴 DB 구조 복원 스크립트 (데이터 복원 없음)
-- 목적: public 스키마의 테이블/컬럼 구조를 레포 기준으로 재구성
-- 주의: 이 스크립트는 기존 테이블을 DROP 후 CREATE 하므로 기존 데이터는 삭제됩니다.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) 뷰/트리거/함수 정리
DROP VIEW IF EXISTS user_notification_stats;
DROP VIEW IF EXISTS monthly_attendance_summary;
DROP VIEW IF EXISTS attendance_stats;
DROP VIEW IF EXISTS recurring_templates_view;

DO $$
BEGIN
    IF to_regclass('public.match_participants') IS NOT NULL THEN
        EXECUTE 'DROP TRIGGER IF EXISTS trigger_update_match_participants_count ON public.match_participants';
    END IF;

    IF to_regclass('public.attendances') IS NOT NULL THEN
        EXECUTE 'DROP TRIGGER IF EXISTS trigger_update_attendance_updated_at ON public.attendances';
    END IF;

    IF to_regclass('public.team_assignments') IS NOT NULL THEN
        EXECUTE 'DROP TRIGGER IF EXISTS update_team_assignments_timestamp ON public.team_assignments';
    END IF;

    IF to_regclass('public.match_player_status') IS NOT NULL THEN
        EXECUTE 'DROP TRIGGER IF EXISTS trigger_update_match_overall_status ON public.match_player_status';
    END IF;
END
$$;

DROP FUNCTION IF EXISTS public.update_match_participants_count();
DROP FUNCTION IF EXISTS public.update_attendance_updated_at();
DROP FUNCTION IF EXISTS public.update_team_assignments_updated_at();
DROP FUNCTION IF EXISTS public.update_match_overall_status();
DROP FUNCTION IF EXISTS public.generate_recurring_matches();
DROP FUNCTION IF EXISTS public.daily_match_generation();

-- 2) 테이블 정리 (의존성 역순)
DROP TABLE IF EXISTS public.match_player_status CASCADE;
DROP TABLE IF EXISTS public.match_results CASCADE;
DROP TABLE IF EXISTS public.tournament_matches CASCADE;
DROP TABLE IF EXISTS public.tournaments CASCADE;
DROP TABLE IF EXISTS public.team_assignments CASCADE;
DROP TABLE IF EXISTS public.recurring_match_templates CASCADE;
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.attendances CASCADE;
DROP TABLE IF EXISTS public.match_participants CASCADE;
DROP TABLE IF EXISTS public.match_schedules CASCADE;
DROP TABLE IF EXISTS public.generated_matches CASCADE;
DROP TABLE IF EXISTS public.match_sessions CASCADE;
DROP TABLE IF EXISTS public.dashboard_menus CASCADE;
DROP TABLE IF EXISTS public.courts CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.level_info CASCADE;

-- 3) 기준 테이블 생성
CREATE TABLE public.level_info (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE,
    full_name TEXT,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    skill_level TEXT NOT NULL DEFAULT 'E2' REFERENCES public.level_info(code),
    gender TEXT CHECK (gender IN ('M', 'F', 'O')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.courts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_index INTEGER,
    location TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.dashboard_menus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    icon TEXT,
    admin_only BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.match_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_name TEXT NOT NULL,
    session_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    total_matches INTEGER NOT NULL DEFAULT 0,
    assigned_matches INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.generated_matches (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES public.match_sessions(id) ON DELETE CASCADE,
    match_number INTEGER NOT NULL,
    team1_player1_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    team1_player2_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    team2_player1_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    team2_player2_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    match_type TEXT NOT NULL DEFAULT 'level_based',
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    match_result JSONB,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, match_number)
);

CREATE TABLE public.match_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    generated_match_id BIGINT REFERENCES public.generated_matches(id) ON DELETE CASCADE,
    match_date DATE,
    scheduled_date DATE,
    start_time TIME,
    end_time TIME,
    scheduled_time TIME,
    court_number INTEGER,
    location VARCHAR(255),
    max_participants INTEGER NOT NULL DEFAULT 20,
    current_participants INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'ongoing', 'in_progress', 'completed', 'cancelled')),
    description TEXT,
    match_result JSONB,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.match_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_schedule_id UUID NOT NULL REFERENCES public.match_schedules(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'cancelled', 'attended', 'absent')),
    notes TEXT,
    UNIQUE (match_schedule_id, user_id)
);

CREATE TABLE public.attendances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    attended_at DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'lesson', 'absent')),
    match_schedule_id UUID REFERENCES public.match_schedules(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, attended_at)
);

CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'general' CHECK (type IN ('general', 'match_preparation', 'match_result', 'schedule_change', 'system')),
    related_match_id BIGINT REFERENCES public.generated_matches(id) ON DELETE SET NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ
);

CREATE TABLE public.recurring_match_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    location VARCHAR(255) NOT NULL,
    max_participants INTEGER NOT NULL DEFAULT 20,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    advance_days INTEGER NOT NULL DEFAULT 7,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.team_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_date DATE NOT NULL,
    round_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    team_type TEXT NOT NULL,
    racket_team JSONB,
    shuttle_team JSONB,
    team1 JSONB,
    team2 JSONB,
    team3 JSONB,
    team4 JSONB,
    pairs_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.tournaments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    tournament_date DATE NOT NULL,
    round_number INTEGER NOT NULL DEFAULT 1,
    match_type TEXT NOT NULL DEFAULT 'random',
    team_assignment_id UUID NOT NULL REFERENCES public.team_assignments(id) ON DELETE CASCADE,
    team_type TEXT NOT NULL,
    total_teams INTEGER NOT NULL,
    matches_per_player INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.tournament_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    round INTEGER NOT NULL,
    match_number INTEGER NOT NULL,
    team1 TEXT[] NOT NULL,
    team2 TEXT[] NOT NULL,
    court TEXT NOT NULL,
    scheduled_time TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
    score_team1 INTEGER,
    score_team2 INTEGER,
    winner TEXT CHECK (winner IN ('team1', 'team2', 'draw')),
    next_match_id UUID REFERENCES public.tournament_matches(id) ON DELETE SET NULL,
    next_match_slot SMALLINT CHECK (next_match_slot IN (1, 2)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.match_results (
    id BIGSERIAL PRIMARY KEY,
    match_id BIGINT NOT NULL REFERENCES public.generated_matches(id) ON DELETE CASCADE,
    winner_team1 BOOLEAN NOT NULL,
    team1_score INTEGER NOT NULL CHECK (team1_score >= 0),
    team2_score INTEGER NOT NULL CHECK (team2_score >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (match_id)
);

CREATE TABLE public.match_player_status (
    id BIGSERIAL PRIMARY KEY,
    match_id BIGINT NOT NULL REFERENCES public.generated_matches(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    UNIQUE (match_id, user_id)
);

-- 4) 인덱스
CREATE INDEX idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX idx_profiles_role ON public.profiles(role);
CREATE INDEX idx_match_sessions_date ON public.match_sessions(session_date);
CREATE INDEX idx_generated_matches_session ON public.generated_matches(session_id);
CREATE INDEX idx_generated_matches_status ON public.generated_matches(status);
CREATE INDEX idx_match_schedules_match_date ON public.match_schedules(match_date);
CREATE INDEX idx_match_schedules_scheduled_date ON public.match_schedules(scheduled_date);
CREATE INDEX idx_match_schedules_generated_match_id ON public.match_schedules(generated_match_id);
CREATE INDEX idx_match_schedules_status ON public.match_schedules(status);
CREATE INDEX idx_match_participants_schedule ON public.match_participants(match_schedule_id);
CREATE INDEX idx_match_participants_user ON public.match_participants(user_id);
CREATE INDEX idx_attendances_user_date ON public.attendances(user_id, attended_at);
CREATE INDEX idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX idx_notifications_is_read ON public.notifications(is_read);
CREATE INDEX idx_team_assignments_date_round ON public.team_assignments(assignment_date, round_number);
CREATE INDEX idx_tournaments_assignment ON public.tournaments(team_assignment_id);
CREATE INDEX idx_tournament_matches_tournament ON public.tournament_matches(tournament_id);
CREATE INDEX idx_tournament_matches_next_match ON public.tournament_matches(next_match_id) WHERE next_match_id IS NOT NULL;
CREATE INDEX idx_match_player_status_match_id ON public.match_player_status(match_id);
CREATE INDEX idx_match_player_status_user_id ON public.match_player_status(user_id);

-- 5) 갱신 트리거 함수
CREATE OR REPLACE FUNCTION public.update_attendance_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_team_assignments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_match_participants_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.match_schedules
        SET current_participants = (
            SELECT COUNT(*)
            FROM public.match_participants
            WHERE match_schedule_id = NEW.match_schedule_id
              AND status IN ('registered', 'attended')
        )
        WHERE id = NEW.match_schedule_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.match_schedules
        SET current_participants = (
            SELECT COUNT(*)
            FROM public.match_participants
            WHERE match_schedule_id = OLD.match_schedule_id
              AND status IN ('registered', 'attended')
        )
        WHERE id = OLD.match_schedule_id;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE public.match_schedules
        SET current_participants = (
            SELECT COUNT(*)
            FROM public.match_participants
            WHERE match_schedule_id = NEW.match_schedule_id
              AND status IN ('registered', 'attended')
        )
        WHERE id = NEW.match_schedule_id;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_match_overall_status()
RETURNS TRIGGER AS $$
DECLARE
    target_match_id BIGINT;
BEGIN
    target_match_id := COALESCE(NEW.match_id, OLD.match_id);

    UPDATE public.generated_matches
    SET status = CASE
        WHEN EXISTS (
            SELECT 1
            FROM public.match_player_status
            WHERE match_id = target_match_id
              AND status = 'completed'
        ) THEN 'completed'
        WHEN EXISTS (
            SELECT 1
            FROM public.match_player_status
            WHERE match_id = target_match_id
              AND status = 'in_progress'
        ) THEN 'in_progress'
        WHEN EXISTS (
            SELECT 1
            FROM public.match_player_status
            WHERE match_id = target_match_id
        )
        AND NOT EXISTS (
            SELECT 1
            FROM public.match_player_status
            WHERE match_id = target_match_id
              AND status <> 'cancelled'
        ) THEN 'cancelled'
        ELSE 'scheduled'
    END,
    updated_at = NOW()
    WHERE id = target_match_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_attendance_updated_at
BEFORE UPDATE ON public.attendances
FOR EACH ROW
EXECUTE FUNCTION public.update_attendance_updated_at();

CREATE TRIGGER update_team_assignments_timestamp
BEFORE UPDATE ON public.team_assignments
FOR EACH ROW
EXECUTE FUNCTION public.update_team_assignments_updated_at();

CREATE TRIGGER trigger_update_match_participants_count
AFTER INSERT OR UPDATE OR DELETE ON public.match_participants
FOR EACH ROW
EXECUTE FUNCTION public.update_match_participants_count();

CREATE TRIGGER trigger_update_match_overall_status
AFTER INSERT OR UPDATE OR DELETE ON public.match_player_status
FOR EACH ROW
EXECUTE FUNCTION public.update_match_overall_status();

-- 6) 뷰
CREATE VIEW public.attendance_stats AS
SELECT
    user_id,
    attended_at,
    status,
    match_schedule_id,
    EXTRACT(YEAR FROM attended_at) AS year,
    EXTRACT(MONTH FROM attended_at) AS month,
    EXTRACT(WEEK FROM attended_at) AS week
FROM public.attendances;

CREATE VIEW public.monthly_attendance_summary AS
SELECT
    user_id,
    EXTRACT(YEAR FROM attended_at) AS year,
    EXTRACT(MONTH FROM attended_at) AS month,
    COUNT(*) FILTER (WHERE status = 'present') AS present_count,
    COUNT(*) FILTER (WHERE status = 'absent') AS absent_count,
    COUNT(*) AS total_days,
    ROUND(
        COUNT(*) FILTER (WHERE status = 'present')::numeric
        / NULLIF(COUNT(*), 0) * 100,
        1
    ) AS attendance_rate
FROM public.attendances
GROUP BY user_id, EXTRACT(YEAR FROM attended_at), EXTRACT(MONTH FROM attended_at);

CREATE VIEW public.user_notification_stats AS
SELECT
    user_id,
    COUNT(*) AS total_notifications,
    COUNT(*) FILTER (WHERE is_read = FALSE) AS unread_count,
    COUNT(*) FILTER (WHERE is_read = TRUE) AS read_count,
    MAX(created_at) AS latest_notification
FROM public.notifications
GROUP BY user_id;

CREATE VIEW public.recurring_templates_view AS
SELECT
    id,
    name,
    description,
    CASE day_of_week
        WHEN 0 THEN '일요일'
        WHEN 1 THEN '월요일'
        WHEN 2 THEN '화요일'
        WHEN 3 THEN '수요일'
        WHEN 4 THEN '목요일'
        WHEN 5 THEN '금요일'
        WHEN 6 THEN '토요일'
    END AS day_name,
    day_of_week,
    start_time,
    end_time,
    location,
    max_participants,
    is_active,
    advance_days,
    created_at
FROM public.recurring_match_templates;

COMMIT;

-- 실행 후 검증
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
-- SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position;
