-- 팀주간업무: 업무가 들어 있는 주차도 삭제 (2026-11-08)
-- 주차 작성자·관리자만. 지우기 전에 주차와 그 안의 업무를 hr_deleted_weeks에 보관한다(되살릴 때 씀).
-- 업무 행(hr_weekly·hr_tasks)은 각 행 작성자만 지울 수 있는 규칙이라, 주차째 지우는 일은 이 함수로만 한다.

create table if not exists public.hr_deleted_weeks (
  id bigint generated always as identity primary key,
  kind text not null,
  week jsonb not null,          -- hr_weeks 행
  rows jsonb not null,          -- hr_weekly(plan) 또는 hr_tasks(report) 행들
  deleted_by text not null default (auth.jwt() ->> 'email'),
  deleted_at timestamptz not null default now()
);
alter table public.hr_deleted_weeks enable row level security;
create policy hr_deleted_weeks_read on public.hr_deleted_weeks for select to authenticated using ((select public.hr_is_admin()));

create or replace function public.hr_delete_week(p_id text) returns int
language plpgsql security definer set search_path to '' as $$
declare
  w public.hr_weeks;
  n int;
begin
  select * into w from public.hr_weeks where id = p_id for update;
  if not found then
    raise exception '주차를 찾지 못했습니다';
  end if;
  if not (public.hr_is_admin() or lower(coalesce(w.created_by, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))) then
    raise exception '주차를 만든 사람이나 관리자만 삭제할 수 있습니다';
  end if;
  if w.kind = 'plan' then
    insert into public.hr_deleted_weeks (kind, week, rows)
      select w.kind, to_jsonb(w), coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.hr_weekly x where x.sheet = p_id;
    delete from public.hr_weekly where sheet = p_id;
  else
    insert into public.hr_deleted_weeks (kind, week, rows)
      select w.kind, to_jsonb(w), coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.hr_tasks x where x.sheet = p_id;
    delete from public.hr_tasks where sheet = p_id;
  end if;
  get diagnostics n = row_count;
  delete from public.hr_weeks where id = p_id;
  return n;  -- 함께 지운 업무 행 수
end $$;
revoke execute on function public.hr_delete_week(text) from public, anon;
grant execute on function public.hr_delete_week(text) to authenticated;
