-- Supabase Dashboard > SQL Editor에서 한 번 실행하세요.
-- 고장 난 auth.users 트리거가 인증 계정 생성을 막지 않도록 제거합니다.
-- 프로필과 클럽 멤버십은 애플리케이션 서버가 명시적으로 생성합니다.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user_signup();
