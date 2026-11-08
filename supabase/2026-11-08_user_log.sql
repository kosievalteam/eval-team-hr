-- 관리자 › 사용 로그 (2026-11-08). 로그는 log_viewer(김미정)만 볼 수 있다(관리자 권한과 별개).
--   접속·화면·반영(SIMS 엑셀): 앱이 hr_log()로 남김 / 추가·수정·삭제: 각 표의 트리거(hr_audit)가 DB에서 직접 남김
--   1년 지난 로그는 매일 지운다(pg_cron hr-user-log-cleanup).

alter table public.hr_members add column if not exists log_viewer boolean not null default false;
update public.hr_members set log_viewer = true where name = '김미정';

create or replace function public.hr_is_log_viewer() returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.hr_members m
                 where lower(m.email) = lower(auth.jwt() ->> 'email') and m.active and m.log_viewer)
$$;

create table if not exists public.hr_user_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  email text,
  name text,                -- 팀원 이름(시스템 작업은 '시스템')
  kind text not null,       -- 접속·화면·추가·수정·삭제
  target text not null default '',   -- 화면 이름 또는 표 이름
  detail text not null default '',
  data jsonb                -- 수정: 바뀐 칸 {칸: [전, 후]}, 추가·삭제: 그 행
);
create index if not exists hr_user_log_at on public.hr_user_log (at desc);
alter table public.hr_user_log enable row level security;
create policy hr_user_log_read on public.hr_user_log for select to authenticated using ((select public.hr_is_log_viewer()));

-- 앱이 남기는 접속·화면 기록(팀원만, 이메일·이름은 서버가 채움)
create or replace function public.hr_log(p_kind text, p_target text, p_detail text) returns void
language plpgsql security definer set search_path to '' as $$
begin
  if not public.hr_is_member() or p_kind not in ('접속', '화면', '반영') then return; end if;
  insert into public.hr_user_log (email, name, kind, target, detail)
  values (lower(auth.jwt() ->> 'email'), public.hr_my_name(), p_kind, left(coalesce(p_target, ''), 60), left(coalesce(p_detail, ''), 200));
end $$;
revoke execute on function public.hr_log(text, text, text) from public, anon;
grant execute on function public.hr_log(text, text, text) to authenticated;

-- 추가·수정·삭제 기록(트리거)
create or replace function public.hr_audit() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  diff jsonb;
  label text := case tg_table_name
    when 'hr_leave' then '근태' when 'hr_notices' then '공지사항' when 'hr_weeks' then '주간업무 주차'
    when 'hr_weekly' then '팀주간업무' when 'hr_tasks' then '개인별업무' when 'hr_review' then '협의검토 입력'
    when 'hr_duty' then '업무분장' when 'hr_events' then '팀 일정' when 'hr_pc_log' then '공용 PC 사용대장'
    when 'hr_supply' then '사무용품 신청대장' else tg_table_name end;
  em text := lower(auth.jwt() ->> 'email');
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value)) into diff
      from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value and n.key not in ('updated_at');
    if diff is null then return new; end if;
  end if;
  insert into public.hr_user_log (email, name, kind, target, detail, data)
  values (em, coalesce(public.hr_my_name(), case when em is null then '시스템' else em end),
          case tg_op when 'INSERT' then '추가' when 'UPDATE' then '수정' else '삭제' end, label,
          left(concat_ws(' · ', r ->> 'no', r ->> 'name', r ->> 'requester', r ->> 'user_name', r ->> 'owner',
                         r ->> 'title', r ->> 'area', r ->> 'kind', r ->> 'start_date', r ->> 'req_date'), 200),
          case when tg_op = 'UPDATE' then diff else r end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  foreach t in array array['hr_leave', 'hr_notices', 'hr_weeks', 'hr_weekly', 'hr_tasks', 'hr_review', 'hr_duty',
                           'hr_events', 'hr_pc_log', 'hr_supply'] loop
    execute format('drop trigger if exists hr_audit on public.%I', t);
    execute format('create trigger hr_audit after insert or update or delete on public.%I for each row execute function public.hr_audit()', t);
  end loop;
end $$;

-- 1년 지난 로그 정리(매일 04:17 UTC)
select cron.unschedule('hr-user-log-cleanup') where exists (select 1 from cron.job where jobname = 'hr-user-log-cleanup');
select cron.schedule('hr-user-log-cleanup', '17 4 * * *', $c$ delete from public.hr_user_log where at < now() - interval '365 days' $c$);
