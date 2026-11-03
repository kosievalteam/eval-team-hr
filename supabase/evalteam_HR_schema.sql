-- HR앱 전용 Supabase 프로젝트(evalteam_HR) DB 구조 (2026-11-04)
-- kosievalteam's Project에 있던 hr_ 표·함수·보안 규칙을 그대로 옮기고, 진행현황 숫자(hr_weekly.stats)를 포함한다.
-- 새 프로젝트의 SQL Editor에 통째로 붙여 넣고 Run. 데이터는 tools/migrate_to_evalteam_hr.py가 옮긴다.

-- ------------------------------------------------------------ 가입 제한: @kosi.re.kr만
create or replace function public.restrict_signup_domain() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.email !~* '^[^@[:space:]]+@kosi\.re\.kr$' then
    raise exception '@kosi.re.kr 이메일만 가입할 수 있습니다.';
  end if;
  return new;
end $$;
create trigger restrict_signup_domain before insert on auth.users for each row execute function public.restrict_signup_domain();

-- ------------------------------------------------------------ 표
create table public.hr_members (
  email text primary key,
  name text not null unique,
  is_admin boolean not null default false,
  active boolean not null default true
);
create table public.hr_upload_token (
  id integer primary key default 1 check (id = 1),
  token_sha256 text not null
);
create table public.hr_snapshot (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table public.hr_leave (
  id bigint generated always as identity primary key,
  name text not null,
  start_date date not null,
  end_date date not null,
  kind text not null,
  note text not null default '',
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create table public.hr_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 200),
  body text not null default '',
  author text not null default '',
  important boolean not null default false,
  date date not null default current_date,
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  slack_ts text
);
create table public.hr_slack_notices (
  ts text primary key,
  author text not null default '',
  text text not null default '',
  date date not null,
  edited boolean not null default false,
  reply_count integer not null default 0,
  permalink text not null default ''
);
create table public.hr_review (
  no text primary key,
  assignee text,
  draft text,
  draft_review text,
  sent text,
  memo text,
  updated_by text default (auth.jwt() ->> 'email'),
  updated_at timestamptz not null default now()
);
create table public.hr_weeks (
  id text primary key default gen_random_uuid()::text,   -- 엑셀에서 가져온 주차는 시트명
  kind text not null check (kind in ('plan', 'report')),  -- plan = 주간업무계획, report = 개인별 주간업무보고
  title text not null,
  status text not null default '',
  progress_label text not null default '진행',
  plan_label text not null default '계획',
  start_date date,
  end_date date,
  sort integer not null default 0,                         -- 클수록 최신
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.hr_weekly (
  id bigint generated always as identity primary key,
  sheet text not null,
  area text not null,
  progress text not null default '',
  plan text not null default '',
  key text not null default '',
  author text not null default '',
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed boolean not null default false,
  written text not null default '',
  source text not null default 'web',
  stats jsonb   -- '사전협의' 진행현황 숫자 {"wait","reject","kosi","office","done"}
);
create table public.hr_tasks (
  id bigint generated always as identity primary key,
  sheet text not null,
  owner text not null,
  name text not null default '',
  content text not null default '',
  priority smallint not null default 0 check (priority between 0 and 4),
  status text not null default '진행 중',
  start_date date,
  due date,
  done date,
  result text not null default '',
  memo text not null default '',
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source text not null default 'web'
);
create table public.hr_pc_log (
  id bigint generated always as identity primary key,
  start_at timestamptz not null default now(),
  end_at timestamptz,
  user_name text not null,
  purpose text not null default '',
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at is null or end_at >= start_at)
);

-- ------------------------------------------------------------ 공통 함수
create or replace function public.hr_touch() returns trigger
language plpgsql set search_path to '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.hr_my_email() returns text
language sql stable set search_path to '' as $$ select lower(auth.jwt() ->> 'email') $$;

create or replace function public.hr_is_member() returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.hr_members m where lower(m.email) = lower(auth.jwt() ->> 'email') and m.active)
$$;
create or replace function public.hr_is_admin() returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.hr_members m where lower(m.email) = lower(auth.jwt() ->> 'email') and m.active and m.is_admin)
$$;
create or replace function public.hr_my_name() returns text
language sql stable security definer set search_path to '' as $$
  select m.name from public.hr_members m where lower(m.email) = lower(auth.jwt() ->> 'email') and m.active
$$;
create or replace function public.hr_member_email(p_name text) returns text
language sql stable security definer set search_path to '' as $$
  select lower(m.email) from public.hr_members m where m.name = p_name and m.active limit 1
$$;

create or replace function public.hr_check_token(p_token text) returns void
language plpgsql security definer set search_path to '' as $$
begin
  if not exists (select 1 from public.hr_upload_token t
                 where t.token_sha256 = encode(extensions.digest(p_token, 'sha256'), 'hex')) then
    raise exception 'invalid upload token' using errcode = '42501';
  end if;
end $$;

-- 처음 한 번만: 배포 토큰을 등록한다(이미 있으면 거부). 토큰 원문은 관리자 PC(.secret)에만 있다.
create or replace function public.hr_set_token_once(p_token text) returns void
language plpgsql security definer set search_path to '' as $$
begin
  if exists (select 1 from public.hr_upload_token) then
    raise exception 'upload token already set' using errcode = '42501';
  end if;
  insert into public.hr_upload_token (id, token_sha256) values (1, encode(extensions.digest(p_token, 'sha256'), 'hex'));
end $$;

-- ------------------------------------------------------------ 트리거
create trigger hr_leave_touch before update on public.hr_leave for each row execute function public.hr_touch();
create trigger hr_notices_touch before update on public.hr_notices for each row execute function public.hr_touch();
create trigger hr_pc_log_touch before update on public.hr_pc_log for each row execute function public.hr_touch();
create trigger hr_review_touch before update on public.hr_review for each row execute function public.hr_touch();
create trigger hr_tasks_touch before update on public.hr_tasks for each row execute function public.hr_touch();
create trigger hr_weekly_touch before update on public.hr_weekly for each row execute function public.hr_touch();
create trigger hr_weeks_touch before update on public.hr_weeks for each row execute function public.hr_touch();

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

-- ------------------------------------------------------------ 행 단위 보안(RLS)
alter table public.hr_members enable row level security;
alter table public.hr_upload_token enable row level security;   -- 정책 없음 = API로 접근 불가
alter table public.hr_snapshot enable row level security;
alter table public.hr_leave enable row level security;
alter table public.hr_notices enable row level security;
alter table public.hr_slack_notices enable row level security;
alter table public.hr_review enable row level security;
alter table public.hr_weeks enable row level security;
alter table public.hr_weekly enable row level security;
alter table public.hr_tasks enable row level security;
alter table public.hr_pc_log enable row level security;

create policy hr_members_read on public.hr_members for select to authenticated using ((select public.hr_is_member()));
create policy hr_snapshot_read on public.hr_snapshot for select to authenticated using ((select public.hr_is_member()));
create policy hr_slack_notices_read on public.hr_slack_notices for select to authenticated using ((select public.hr_is_member()));

create policy hr_leave_read on public.hr_leave for select to authenticated using ((select public.hr_is_member()));
create policy hr_leave_ins on public.hr_leave for insert to authenticated
  with check ((select public.hr_is_member()) and lower(created_by) = (select public.hr_my_email())
              and (name = (select public.hr_my_name()) or (select public.hr_is_admin())));
create policy hr_leave_upd on public.hr_leave for update to authenticated
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()))
  with check ((select public.hr_is_admin()) or (lower(created_by) = (select public.hr_my_email()) and name = (select public.hr_my_name())));
create policy hr_leave_del on public.hr_leave for delete to authenticated
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));

create policy hr_notices_read on public.hr_notices for select to authenticated using ((select public.hr_is_member()));
create policy hr_notices_ins on public.hr_notices for insert to authenticated
  with check ((select public.hr_is_member()) and lower(created_by) = (select public.hr_my_email()));
create policy hr_notices_upd on public.hr_notices for update to authenticated
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()))
  with check ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));
create policy hr_notices_del on public.hr_notices for delete to authenticated
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));

create policy hr_review_read on public.hr_review for select to authenticated using ((select public.hr_is_member()));
create policy hr_review_ins on public.hr_review for insert to authenticated
  with check ((select public.hr_is_member()) and lower(updated_by) = (select public.hr_my_email()));
create policy hr_review_upd on public.hr_review for update to authenticated
  using ((select public.hr_is_member()))
  with check ((select public.hr_is_member()) and lower(updated_by) = (select public.hr_my_email()));
create policy hr_review_del on public.hr_review for delete to authenticated using ((select public.hr_is_admin()));

create policy hr_weeks_read on public.hr_weeks for select to authenticated using ((select public.hr_is_member()));
create policy hr_weeks_upd on public.hr_weeks for update to authenticated
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()))
  with check ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));
create policy hr_weeks_del on public.hr_weeks for delete to authenticated
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));
-- 주차 생성은 hr_new_week()로만 한다

-- 주간업무계획은 팀 공동 문서: 팀원 누구나 수정, 삭제는 작성자·관리자
create policy hr_weekly_read on public.hr_weekly for select to authenticated using ((select public.hr_is_member()));
create policy hr_weekly_ins on public.hr_weekly for insert to authenticated
  with check ((select public.hr_is_member()) and lower(created_by) = (select public.hr_my_email()));
create policy hr_weekly_upd on public.hr_weekly for update to authenticated
  using ((select public.hr_is_member())) with check ((select public.hr_is_member()));
create policy hr_weekly_del on public.hr_weekly for delete to authenticated
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));

create policy hr_tasks_read on public.hr_tasks for select to authenticated using ((select public.hr_is_member()));
create policy hr_tasks_ins on public.hr_tasks for insert to authenticated
  with check ((select public.hr_is_member()) and lower(created_by) = (select public.hr_my_email())
              and (owner = (select public.hr_my_name()) or (select public.hr_is_admin())));
create policy hr_tasks_upd on public.hr_tasks for update to authenticated
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()))
  with check ((select public.hr_is_admin()) or (lower(created_by) = (select public.hr_my_email()) and owner = (select public.hr_my_name())));
create policy hr_tasks_del on public.hr_tasks for delete to authenticated
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));

create policy hr_pc_log_read on public.hr_pc_log for select to authenticated using ((select public.hr_is_member()));
create policy hr_pc_log_ins on public.hr_pc_log for insert to authenticated
  with check ((select public.hr_is_member()) and lower(created_by) = (select public.hr_my_email()));
create policy hr_pc_log_upd on public.hr_pc_log for update to authenticated
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()))
  with check ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));
create policy hr_pc_log_del on public.hr_pc_log for delete to authenticated
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));

-- 새 프로젝트는 표 권한이 자동으로 주어지지 않을 수 있어 명시한다(실제 접근은 위 RLS가 막는다)
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on public.hr_upload_token from anon, authenticated;

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
