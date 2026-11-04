-- 평가팀 주요 일정 (대시보드·복무관리 달력에 근무현황과 함께 표시) (2026-11-04)
-- 팀 공동 일정: 팀원 누구나 추가·수정, 삭제는 작성자·관리자 (주간업무계획과 같은 규칙)
create table if not exists public.hr_events (
  id bigint generated always as identity primary key,
  title text not null,
  start_date date not null,
  end_date date not null,
  note text not null default '',
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create trigger hr_events_touch before update on public.hr_events for each row execute function public.hr_touch();
alter table public.hr_events enable row level security;
create policy hr_events_read on public.hr_events for select to authenticated using ((select public.hr_is_member()));
create policy hr_events_ins on public.hr_events for insert to authenticated
  with check ((select public.hr_is_member()) and lower(created_by) = (select public.hr_my_email()));
create policy hr_events_upd on public.hr_events for update to authenticated
  using ((select public.hr_is_member())) with check ((select public.hr_is_member()));
create policy hr_events_del on public.hr_events for delete to authenticated
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));
grant select, insert, update, delete on public.hr_events to authenticated;
