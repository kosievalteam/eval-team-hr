-- 주간업무계획 '사전협의' 업무영역의 <사전협의 진행현황> 표 숫자 (2026-11-04)
-- Supabase 대시보드 › SQL Editor에 붙여 넣고 Run.
-- stats 예: {"wait": 1, "reject": 25, "kosi": 38, "office": 36, "done": 54}  (합계는 화면·한글 파일에서 계산)
alter table public.hr_weekly add column stats jsonb;

-- 새 주차를 만들 때 지난주 진행현황 숫자도 이어받는다(나머지는 2026-11-03_weekly_web.sql과 같음)
create or replace function public.hr_new_week(p_kind text, p_title text, p_status text, p_progress_label text,
  p_plan_label text, p_start date, p_end date, p_copy_from text) returns text
language plpgsql security definer set search_path to '' as $$
declare v_id text;
begin
  if not public.hr_is_member() then raise exception '권한이 없습니다.' using errcode = '42501'; end if;
  insert into public.hr_weeks (kind, title, status, progress_label, plan_label, start_date, end_date, sort, created_by)
    values (p_kind, p_title, coalesce(p_status, ''), coalesce(nullif(p_progress_label, ''), '진행'),
            coalesce(nullif(p_plan_label, ''), '계획'), p_start, p_end,
            coalesce((select max(sort) from public.hr_weeks where kind = p_kind), 0) + 1, public.hr_my_email())
    returning id into v_id;
  if p_copy_from is not null and p_kind = 'plan' then
    insert into public.hr_weekly (sheet, area, progress, plan, key, author, stats, created_by)
      select v_id, w.area, w.plan, '', '', w.author, w.stats, coalesce(public.hr_member_email(w.author), w.created_by)
      from public.hr_weekly w where w.sheet = p_copy_from order by w.id;
  elsif p_copy_from is not null and p_kind = 'report' then
    insert into public.hr_tasks (sheet, owner, name, content, priority, status, start_date, due, done, result, memo, created_by)
      select v_id, t.owner, t.name, t.content, t.priority, t.status, t.start_date, t.due, t.done, t.result, t.memo,
             coalesce(public.hr_member_email(t.owner), t.created_by)
      from public.hr_tasks t where t.sheet = p_copy_from and t.status not in ('완료', '중단') order by t.id;
  end if;
  return v_id;
end $$;
