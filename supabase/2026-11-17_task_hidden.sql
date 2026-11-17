-- 개인별업무 '팀장만 보기' (2026-11-17). hidden = true인 업무는 담당자·작성자·관리자(팀장)만 읽을 수 있다(DB에서 막음).
alter table public.hr_tasks add column if not exists hidden boolean not null default false;

drop policy if exists hr_tasks_read on public.hr_tasks;
create policy hr_tasks_read on public.hr_tasks for select to authenticated
  using ((select public.hr_is_member()) and (not hidden or (select public.hr_is_admin())
         or owner = (select public.hr_my_name()) or lower(created_by) = (select public.hr_my_email())));

-- 다음 주차로 옮길 때도 '팀장만 보기'를 유지한다(2026-11-17_task_carry.sql의 두 함수에 hidden 추가)
create or replace function public.hr_task_copy(p_task public.hr_tasks, p_sheet text) returns void
language plpgsql security definer set search_path to '' as $$
declare root bigint := coalesce(p_task.origin_id, p_task.id);
begin
  if exists (select 1 from public.hr_tasks x where x.sheet = p_sheet
             and (coalesce(x.origin_id, x.id) = root or (x.owner = p_task.owner and x.name = p_task.name))) then
    return;
  end if;
  insert into public.hr_tasks (sheet, owner, name, content, priority, status, start_date, due, done, result, memo, created_by, origin_id, hidden)
  values (p_sheet, p_task.owner, p_task.name, p_task.content, p_task.priority,
          case when p_task.status = '시작 전' then '시작 전' else '진행 중' end,
          p_task.start_date, p_task.due, null, '', '', p_task.created_by, root, p_task.hidden);
end $$;
revoke execute on function public.hr_task_copy(public.hr_tasks, text) from public, anon, authenticated;

create or replace function public.hr_new_week(p_kind text, p_title text, p_status text, p_progress_label text,
  p_plan_label text, p_start date, p_end date, p_copy_from text) returns text
language plpgsql security definer set search_path to '' as $$
declare v_id text; v_prev text; t public.hr_tasks;
begin
  if not public.hr_is_member() then raise exception '권한이 없습니다.' using errcode = '42501'; end if;
  if p_kind = 'report' then
    select id into v_prev from public.hr_weeks where kind = 'report'
      order by (p_start is not null and end_date < p_start) desc, coalesce(end_date, '1900-01-01') desc, sort desc limit 1;
  end if;
  insert into public.hr_weeks (kind, title, status, progress_label, plan_label, start_date, end_date, sort, created_by)
    values (p_kind, p_title, coalesce(p_status, ''), coalesce(nullif(p_progress_label, ''), '진행'),
            coalesce(nullif(p_plan_label, ''), '계획'), p_start, p_end,
            coalesce((select max(sort) from public.hr_weeks where kind = p_kind), 0) + 1, public.hr_my_email())
    returning id into v_id;
  if p_copy_from is not null and p_kind = 'plan' then
    insert into public.hr_weekly (sheet, area, progress, plan, key, author, stats, created_by)
      select v_id, w.area, w.plan, '', '', w.author, w.stats, coalesce(public.hr_member_email(w.author), w.created_by)
      from public.hr_weekly w where w.sheet = p_copy_from order by w.id;
  elsif p_kind = 'report' then
    if p_copy_from is not null then
      insert into public.hr_tasks (sheet, owner, name, content, priority, status, start_date, due, done, result, memo, created_by, origin_id, hidden)
        select v_id, t.owner, t.name, t.content, t.priority, t.status, t.start_date, t.due, t.done, t.result, t.memo,
               coalesce(public.hr_member_email(t.owner), t.created_by), coalesce(t.origin_id, t.id), t.hidden
        from public.hr_tasks t where t.sheet = p_copy_from and t.status not in ('완료', '중단') order by t.id;
    end if;
    for t in select * from public.hr_tasks x where x.sheet = coalesce(p_copy_from, v_prev)
               and x.status not in ('완료', '중단') and x.due is not null
               and (p_start is null or x.due >= p_start) and (p_end is null or x.start_date is null or x.start_date <= p_end)
             order by x.id loop
      perform public.hr_task_copy(t, v_id);
    end loop;
  end if;
  return v_id;
end $$;
revoke execute on function public.hr_new_week(text, text, text, text, text, date, date, text) from public, anon;
grant execute on function public.hr_new_week(text, text, text, text, text, date, date, text) to authenticated;
