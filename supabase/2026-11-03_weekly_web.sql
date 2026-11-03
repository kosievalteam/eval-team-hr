-- 주간업무관리를 엑셀 대신 웹(Supabase)에서 작성·수정하도록 전환 (2026-11-03)
-- Supabase 대시보드 › SQL Editor에 통째로 붙여 넣고 Run. 기존 데이터는 지우지 않는다.

create table public.hr_weeks (
  id text primary key default gen_random_uuid()::text,   -- 엑셀에서 가져온 주차는 시트명
  kind text not null check (kind in ('plan', 'report')),  -- plan = 주간업무계획, report = 개인별 주간업무보고
  title text not null,
  status text not null default '',
  progress_label text not null default '진행',
  plan_label text not null default '계획',
  start_date date,
  end_date date,
  sort int not null default 0,                             -- 클수록 최신
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger hr_weeks_touch before update on public.hr_weeks for each row execute function public.hr_touch();
alter table public.hr_weeks enable row level security;
create policy hr_weeks_read on public.hr_weeks for select using ((select public.hr_is_member()));
create policy hr_weeks_upd on public.hr_weeks for update
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()))
  with check ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));
create policy hr_weeks_del on public.hr_weeks for delete
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));
-- 주차 생성은 hr_new_week()로만 한다(이전 주 복사 포함)

alter table public.hr_weekly add column reviewed boolean not null default false,
  add column written text not null default '',
  add column source text not null default 'web';
alter table public.hr_tasks add column source text not null default 'web';

-- 주간업무계획은 팀 공동 문서: 팀원 누구나 수정, 삭제는 작성자·관리자
drop policy hr_weekly_upd on public.hr_weekly;
create policy hr_weekly_upd on public.hr_weekly for update
  using ((select public.hr_is_member())) with check ((select public.hr_is_member()));

-- 팀장 검토 표시는 관리자만 바꿀 수 있다
create or replace function public.hr_weekly_guard() returns trigger
language plpgsql set search_path to '' as $$
begin
  if new.reviewed is distinct from (case when tg_op = 'UPDATE' then old.reviewed else false end)
     and not public.hr_is_admin() and current_user = 'authenticated' then
    raise exception '팀장 검토 표시는 관리자만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger hr_weekly_guard before insert or update on public.hr_weekly for each row execute function public.hr_weekly_guard();

create or replace function public.hr_member_email(p_name text) returns text
language sql stable security definer set search_path to '' as $$
  select lower(m.email) from public.hr_members m where m.name = p_name and m.active limit 1
$$;

-- 새 주차 만들기. p_copy_from 주차의 내용을 이어받는다.
--   plan  : 업무영역·작성자 복사, 지난주 '계획'을 이번 주 '진행'으로, 계획·핵심업무는 비움
--   report: 완료·중단이 아닌 업무를 그대로 복사
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
    insert into public.hr_weekly (sheet, area, progress, plan, key, author, created_by)
      select v_id, w.area, w.plan, '', '', w.author, coalesce(public.hr_member_email(w.author), w.created_by)
      from public.hr_weekly w where w.sheet = p_copy_from order by w.id;
  elsif p_copy_from is not null and p_kind = 'report' then
    insert into public.hr_tasks (sheet, owner, name, content, priority, status, start_date, due, done, result, memo, created_by)
      select v_id, t.owner, t.name, t.content, t.priority, t.status, t.start_date, t.due, t.done, t.result, t.memo,
             coalesce(public.hr_member_email(t.owner), t.created_by)
      from public.hr_tasks t where t.sheet = p_copy_from and t.status not in ('완료', '중단') order by t.id;
  end if;
  return v_id;
end $$;

-- 엑셀 → 웹 1회 가져오기 (배포 토큰 필요). 이미 가져왔으면 p_force 없이는 거부한다.
create or replace function public.hr_import_weekly(p_token text, p_plan jsonb, p_report jsonb, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare w jsonb; i int; n int; v_items int := 0; v_tasks int := 0;
begin
  if not exists (select 1 from public.hr_upload_token t
                 where t.token_sha256 = encode(extensions.digest(p_token, 'sha256'), 'hex')) then
    raise exception 'invalid upload token' using errcode = '42501';
  end if;
  if exists (select 1 from public.hr_weeks) and not p_force then
    raise exception '이미 가져왔습니다. 다시 가져오면 웹에서 고친 엑셀 항목이 덮어써집니다(--force).';
  end if;
  delete from public.hr_weekly where source = 'excel';
  delete from public.hr_tasks where source = 'excel';

  n := jsonb_array_length(p_plan);
  for i in 0 .. n - 1 loop          -- 엑셀 시트 순서(앞 = 최신)
    w := p_plan -> i;
    insert into public.hr_weeks (id, kind, title, status, progress_label, plan_label, sort, created_by)
      values (w ->> 'sheet', 'plan', w ->> 'title', coalesce(w ->> 'status', ''), w ->> 'progress_label',
              w ->> 'plan_label', n - i, null)
      on conflict (id) do update set title = excluded.title, status = excluded.status,
        progress_label = excluded.progress_label, plan_label = excluded.plan_label, sort = excluded.sort;
    insert into public.hr_weekly (sheet, area, progress, plan, key, author, written, reviewed, source, created_by)
      select w ->> 'sheet', x ->> 'area', x ->> 'progress', x ->> 'plan', x ->> 'key', x ->> 'author',
             x ->> 'written', (x ->> 'reviewed')::boolean, 'excel', public.hr_member_email(x ->> 'author')
      from jsonb_array_elements(w -> 'items') with ordinality as e(x, k) order by k;
    v_items := v_items + jsonb_array_length(w -> 'items');
  end loop;

  n := jsonb_array_length(p_report);
  for i in 0 .. n - 1 loop
    w := p_report -> i;
    insert into public.hr_weeks (id, kind, title, start_date, end_date, sort, created_by)
      values (w ->> 'sheet', 'report', w ->> 'title', nullif(w ->> 'start', '')::date, nullif(w ->> 'end', '')::date, n - i, null)
      on conflict (id) do update set title = excluded.title, start_date = excluded.start_date,
        end_date = excluded.end_date, sort = excluded.sort;
    insert into public.hr_tasks (sheet, owner, name, content, priority, status, start_date, due, done, result, memo, source, created_by)
      select w ->> 'sheet', x ->> 'owner', x ->> 'name', x ->> 'content', (x ->> 'priority')::smallint, x ->> 'status',
             nullif(x ->> 'start', '')::date, nullif(x ->> 'due', '')::date, nullif(x ->> 'done', '')::date,
             x ->> 'result', x ->> 'memo', 'excel', public.hr_member_email(x ->> 'owner')
      from jsonb_array_elements(w -> 'tasks') with ordinality as e(x, k) order by k;
    v_tasks := v_tasks + jsonb_array_length(w -> 'tasks');
  end loop;
  return jsonb_build_object('plan_weeks', jsonb_array_length(p_plan), 'items', v_items,
                            'report_weeks', n, 'tasks', v_tasks);
end $$;

revoke execute on function public.hr_import_weekly(text, jsonb, jsonb, boolean) from public, authenticated;
grant execute on function public.hr_import_weekly(text, jsonb, jsonb, boolean) to anon;
revoke execute on function public.hr_new_week(text, text, text, text, text, date, date, text) from public, anon;
grant execute on function public.hr_new_week(text, text, text, text, text, date, date, text) to authenticated;
revoke execute on function public.hr_member_email(text) from public, anon;
grant execute on function public.hr_member_email(text) to authenticated;
