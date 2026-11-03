-- 공용 PC 사용대장 (2026-11-03). Supabase 대시보드 › SQL Editor에 붙여 넣고 Run.
create table public.hr_pc_log (
  id bigint generated always as identity primary key,
  start_at timestamptz not null default now(),   -- 사용시작 일시
  end_at timestamptz,                            -- 사용종료 일시 (사용 중이면 비움)
  user_name text not null,
  purpose text not null default '',
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at is null or end_at >= start_at)
);
create trigger hr_pc_log_touch before update on public.hr_pc_log for each row execute function public.hr_touch();
alter table public.hr_pc_log enable row level security;
create policy hr_pc_log_read on public.hr_pc_log for select using ((select public.hr_is_member()));
create policy hr_pc_log_ins on public.hr_pc_log for insert
  with check ((select public.hr_is_member()) and lower(created_by) = (select public.hr_my_email()));
create policy hr_pc_log_upd on public.hr_pc_log for update
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()))
  with check ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));
create policy hr_pc_log_del on public.hr_pc_log for delete
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));
