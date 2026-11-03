-- evalteam_HR: 남은 단계(배포·웹 기능 함수, 실행 권한) — 2026-11-04
-- 표·함수·트리거·보안 규칙은 이미 적용됨. 이 파일만 evalteam_HR 프로젝트의 SQL Editor에서 Run.
-- (전체 구조는 evalteam_HR_schema.sql 참고)

-- ------------------------------------------------------------ 배포·웹 기능 함수
create or replace function public.hr_put_snapshot(p_token text, p_data jsonb, p_members jsonb) returns integer
language plpgsql security definer set search_path to '' as $$
declare n int;
begin
  perform public.hr_check_token(p_token);
  insert into public.hr_snapshot (id, data, updated_at) values ('main', p_data, now())
    on conflict (id) do update set data = excluded.data, updated_at = now();
  update public.hr_members m set active = false
    where lower(m.email) not in (select lower(x ->> 'email') from jsonb_array_elements(p_members) x);
  insert into public.hr_members (email, name, is_admin, active)
    select lower(x ->> 'email'), x ->> 'name', coalesce((x ->> 'is_admin')::boolean, false), true
    from jsonb_array_elements(p_members) x
    on conflict (email) do update set name = excluded.name, is_admin = excluded.is_admin, active = true;
  select count(*) into n from public.hr_members where active;
  return n;
end $$;

-- 새 주차 만들기. p_copy_from 주차의 내용을 이어받는다.
--   plan  : 업무영역·작성자·진행현황 숫자 복사, 지난주 '계획'을 이번 주 '진행'으로, 계획·핵심업무는 비움
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

-- Slack 공지 동기화
create or replace function public.hr_put_slack(p_token text, p_items jsonb) returns int
language plpgsql security definer set search_path to '' as $$
begin
  perform public.hr_check_token(p_token);
  delete from public.hr_slack_notices where true;
  insert into public.hr_slack_notices (ts, author, text, date, edited, reply_count, permalink)
    select x ->> 'ts', x ->> 'author', x ->> 'text', (x ->> 'date')::date, (x ->> 'edited')::boolean,
           (x ->> 'reply_count')::int, x ->> 'permalink'
    from jsonb_array_elements(p_items) x;
  return jsonb_array_length(p_items);
end $$;
create or replace function public.hr_notices_unposted(p_token text) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin
  perform public.hr_check_token(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body,
           'author', n.author, 'important', n.important) order by n.created_at)
         from public.hr_notices n where n.slack_ts is null), '[]'::jsonb);
end $$;
create or replace function public.hr_notice_posted(p_token text, p_id uuid, p_ts text) returns void
language plpgsql security definer set search_path to '' as $$
begin
  perform public.hr_check_token(p_token);
  update public.hr_notices set slack_ts = p_ts where id = p_id;
end $$;

-- 기존 프로젝트 → 이 프로젝트 1회 이전(tools/migrate_to_evalteam_hr.py). 표가 비어 있을 때만 받는다.
create or replace function public.hr_import_all(p_token text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare t text; n int; res jsonb := '{}';
begin
  perform public.hr_check_token(p_token);
  if exists (select 1 from public.hr_weeks) or exists (select 1 from public.hr_leave) or exists (select 1 from public.hr_notices) then
    raise exception '이미 데이터가 있습니다. 빈 프로젝트에만 옮길 수 있습니다.';
  end if;
  insert into public.hr_members select * from jsonb_populate_recordset(null::public.hr_members, p_data -> 'hr_members');
  insert into public.hr_weeks select * from jsonb_populate_recordset(null::public.hr_weeks, p_data -> 'hr_weeks');
  insert into public.hr_weekly overriding system value select * from jsonb_populate_recordset(null::public.hr_weekly, p_data -> 'hr_weekly');
  insert into public.hr_tasks overriding system value select * from jsonb_populate_recordset(null::public.hr_tasks, p_data -> 'hr_tasks');
  insert into public.hr_leave overriding system value select * from jsonb_populate_recordset(null::public.hr_leave, p_data -> 'hr_leave');
  insert into public.hr_pc_log overriding system value select * from jsonb_populate_recordset(null::public.hr_pc_log, p_data -> 'hr_pc_log');
  insert into public.hr_notices select * from jsonb_populate_recordset(null::public.hr_notices, p_data -> 'hr_notices');
  insert into public.hr_review select * from jsonb_populate_recordset(null::public.hr_review, p_data -> 'hr_review');
  insert into public.hr_slack_notices select * from jsonb_populate_recordset(null::public.hr_slack_notices, p_data -> 'hr_slack_notices');
  -- 자동 번호를 옮긴 마지막 번호 다음부터 이어 간다
  foreach t in array array['hr_weekly', 'hr_tasks', 'hr_leave', 'hr_pc_log'] loop
    execute format('select setval(pg_get_serial_sequence(%L, ''id''), coalesce(max(id), 0) + 1, false) from public.%I', 'public.' || t, t);
  end loop;
  foreach t in array array['hr_members', 'hr_weeks', 'hr_weekly', 'hr_tasks', 'hr_leave', 'hr_pc_log', 'hr_notices', 'hr_review', 'hr_slack_notices'] loop
    execute format('select count(*) from public.%I', t) into n;
    res := res || jsonb_build_object(t, n);
  end loop;
  return res;
end $$;

-- 실행 권한: 배포 토큰 함수는 anon(배포 PC), 화면 함수는 로그인한 팀원
revoke execute on function public.hr_check_token(text) from public, anon, authenticated;
revoke execute on function public.hr_set_token_once(text), public.hr_put_snapshot(text, jsonb, jsonb),
  public.hr_put_slack(text, jsonb), public.hr_notices_unposted(text), public.hr_notice_posted(text, uuid, text),
  public.hr_import_all(text, jsonb) from public, authenticated;
grant execute on function public.hr_set_token_once(text), public.hr_put_snapshot(text, jsonb, jsonb),
  public.hr_put_slack(text, jsonb), public.hr_notices_unposted(text), public.hr_notice_posted(text, uuid, text),
  public.hr_import_all(text, jsonb) to anon;
revoke execute on function public.hr_new_week(text, text, text, text, text, date, date, text),
  public.hr_member_email(text) from public, anon;
grant execute on function public.hr_new_week(text, text, text, text, text, date, date, text),
  public.hr_member_email(text), public.hr_is_member(), public.hr_is_admin(), public.hr_my_name() to authenticated;
