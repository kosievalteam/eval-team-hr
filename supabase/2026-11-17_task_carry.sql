-- 개인별업무: 여러 주에 걸친 업무(완료예정일이 그 주 종료일 이후)를 다음 주차에 자동으로 넣는다 (2026-11-17).
--   ① 업무를 추가·수정해 완료예정일이 그 주 뒤로 가면, 이미 만들어진 뒤 주차 중 [시작일, 완료예정일]과 겹치는 주차에 같은 업무를 넣는다.
--   ② 새 주차를 만들 때는 '내용 이어받기'를 끄더라도, 바로 앞 주차에서 새 주차와 기간이 겹치는 진행 업무를 가져온다.
--   - 완료·중단 업무는 옮기지 않는다. 뒤 주차에 같은 업무(같은 원본 또는 같은 담당·업무명)가 이미 있으면 다시 넣지 않는다.
--   - 옮긴 뒤에는 주차마다 따로 관리한다(상태·결과·메모는 주차별로 적는다).

alter table public.hr_tasks add column if not exists origin_id bigint;  -- 처음 등록된 업무의 id(이어받은 복사본끼리 같은 값)

-- p_task를 p_sheet 주차에 복사(같은 업무가 이미 있으면 건너뜀)
create or replace function public.hr_task_copy(p_task public.hr_tasks, p_sheet text) returns void
language plpgsql security definer set search_path to '' as $$
declare root bigint := coalesce(p_task.origin_id, p_task.id);
begin
  if exists (select 1 from public.hr_tasks x where x.sheet = p_sheet
             and (coalesce(x.origin_id, x.id) = root or (x.owner = p_task.owner and x.name = p_task.name))) then
    return;
  end if;
  insert into public.hr_tasks (sheet, owner, name, content, priority, status, start_date, due, done, result, memo, created_by, origin_id)
  values (p_sheet, p_task.owner, p_task.name, p_task.content, p_task.priority,
          case when p_task.status = '시작 전' then '시작 전' else '진행 중' end,
          p_task.start_date, p_task.due, null, '', '', p_task.created_by, root);
end $$;
revoke execute on function public.hr_task_copy(public.hr_tasks, text) from public, anon, authenticated;

-- ① 추가·수정 시 뒤 주차로 퍼뜨리기
create or replace function public.hr_task_carry() returns trigger
language plpgsql security definer set search_path to '' as $$
declare wk public.hr_weeks; nx record;
begin
  if pg_trigger_depth() > 1 or new.due is null or new.status in ('완료', '중단') then return new; end if;
  if tg_op = 'UPDATE' and new.due is not distinct from old.due and new.start_date is not distinct from old.start_date
     and new.status is not distinct from old.status then return new; end if;
  select * into wk from public.hr_weeks where id = new.sheet and kind = 'report';
  if wk.id is null or wk.end_date is null or new.due <= wk.end_date then return new; end if;
  for nx in select id from public.hr_weeks
            where kind = 'report' and start_date > wk.end_date and start_date <= new.due
              and (new.start_date is null or end_date >= new.start_date)
            order by start_date loop
    perform public.hr_task_copy(new, nx.id);
  end loop;
  return new;
end $$;
drop trigger if exists hr_task_carry on public.hr_tasks;
create trigger hr_task_carry after insert or update on public.hr_tasks for each row execute function public.hr_task_carry();

-- ② 새 주차 만들기: 이어받기를 켜면 지금처럼 진행 업무 전부, 끄더라도 새 주차와 기간이 겹치는 업무는 가져온다
create or replace function public.hr_new_week(p_kind text, p_title text, p_status text, p_progress_label text,
  p_plan_label text, p_start date, p_end date, p_copy_from text) returns text
language plpgsql security definer set search_path to '' as $$
declare v_id text; v_prev text; t public.hr_tasks;
begin
  if not public.hr_is_member() then raise exception '권한이 없습니다.' using errcode = '42501'; end if;
  if p_kind = 'report' then  -- 바로 앞 주차(새 주차 시작일 이전에 끝난 가장 늦은 주차, 없으면 가장 최근 주차)
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
      insert into public.hr_tasks (sheet, owner, name, content, priority, status, start_date, due, done, result, memo, created_by, origin_id)
        select v_id, t.owner, t.name, t.content, t.priority, t.status, t.start_date, t.due, t.done, t.result, t.memo,
               coalesce(public.hr_member_email(t.owner), t.created_by), coalesce(t.origin_id, t.id)
        from public.hr_tasks t where t.sheet = p_copy_from and t.status not in ('완료', '중단') order by t.id;
    end if;
    -- 여러 주에 걸친 업무(새 주차와 기간이 겹침)는 이어받기와 관계없이 가져온다
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
