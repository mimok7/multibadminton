-- 하루 단위 자동 경기 생성 설정 저장소
-- Supabase Dashboard > SQL Editor에서 한 번 실행하세요.

create table if not exists public.match_settings (
  id text primary key default 'default' check (id = 'default'),
  auto_generate_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- 서버의 service role만 이 설정을 읽고 변경합니다.
alter table public.match_settings enable row level security;

insert into public.match_settings (id, auto_generate_enabled)
values ('default', false)
on conflict (id) do nothing;
