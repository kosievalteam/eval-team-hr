-- 원드라이브 '26년 검토의견서 폴더를 클라우드에서 확인 (2026-11-07). PC의 review_watch.py·onedrive_sync.py를 대신한다.
-- Edge Function onedrive-sync(supabase/functions/onedrive-sync)가 5분마다(pg_cron) 폴더 전체를 읽어
--   ① 새 파일 → 분야 담당자 Slack DM  ② 협의번호별 초안·검토본·수정본·최종(팀장) 첫 업로드일 → 협의검토(hr_snapshot)
-- 연결 정보(Microsoft refresh token 등)는 hr_onedrive에만 두고 정책을 만들지 않아 화면(팀원 계정)에서는 읽을 수 없다(서비스 키 전용).

create table if not exists public.hr_onedrive (
  id int primary key default 1 check (id = 1),
  share_url text not null default '',            -- 폴더 공유 링크(1drv.ms)
  setup_key text not null default replace(gen_random_uuid()::text, '-', ''),  -- 로그인 링크용(관리자만 앎)
  cron_key text not null default replace(gen_random_uuid()::text, '-', ''),   -- pg_cron → 함수 호출 확인용
  login_state text,
  refresh_token text,
  account text,                                   -- 연결한 Microsoft 계정
  drive_id text,
  root_id text,
  root_name text,
  baseline_done boolean not null default false,  -- 첫 확인 때 이미 있던 파일은 알리지 않는다
  slack_users jsonb not null default '{}'::jsonb, -- {"이름": "U…"} Slack에서 이름으로 못 찾을 때
  last_run timestamptz,
  last_error text,
  last_result jsonb
);
alter table public.hr_onedrive enable row level security;

create table if not exists public.hr_onedrive_files (
  id text primary key,          -- Graph driveItem id
  path text not null,           -- 공유 폴더 기준 상대 경로(폴더/…/파일명)
  stage text,                   -- 초안·검토본·수정본·최종(팀장)
  field text,                   -- 분야
  case_no text,                 -- 협의번호(2026-0302)
  created timestamptz,          -- 원드라이브에 처음 올라온 시각
  first_seen timestamptz not null default now(),
  notified text                 -- 알림 받은 사람(쉼표)
);
alter table public.hr_onedrive_files enable row level security;
create policy hr_onedrive_files_read on public.hr_onedrive_files for select to authenticated using ((select public.hr_is_member()));

-- 협의번호별 단계 첫 업로드일을 협의검토 스냅샷에 반영(이미 있는 날짜보다 이를 때만 바꾼다). 서비스 키(Edge Function) 전용.
--   p_dates: {"2026-0302": {"draft": "2026-11-06", "draft_review": "2026-11-07"}, …}
create or replace function public.hr_onedrive_dates(p_dates jsonb) returns int
language plpgsql security definer set search_path to '' as $$
declare
  cur jsonb;
  nxt jsonb;
  n int;
begin
  select data -> 'reviews' -> 'rows' into cur from public.hr_snapshot where id = 'main' for update;
  if cur is null then return 0; end if;
  select jsonb_agg(e.r || coalesce((
           select jsonb_object_agg(d.k, d.v) from jsonb_each_text(p_dates -> (e.r ->> 'no')) d(k, v)
           where d.k in ('draft', 'draft_review', 'revised', 'final') and d.v ~ '^\d{4}-\d{2}-\d{2}$'
             and (coalesce(e.r ->> d.k, '') = '' or d.v < e.r ->> d.k)), '{}'::jsonb) order by e.o),
         count(*) filter (where exists (
           select 1 from jsonb_each_text(p_dates -> (e.r ->> 'no')) d(k, v)
           where d.k in ('draft', 'draft_review', 'revised', 'final') and d.v ~ '^\d{4}-\d{2}-\d{2}$'
             and (coalesce(e.r ->> d.k, '') = '' or d.v < e.r ->> d.k)))
    into nxt, n
    from jsonb_array_elements(cur) with ordinality e(r, o);
  if n > 0 then
    update public.hr_snapshot set data = jsonb_set(data, '{reviews,rows}', nxt), updated_at = now() where id = 'main';
  end if;
  return n;  -- 날짜가 바뀐 협의건 수
end $$;
revoke execute on function public.hr_onedrive_dates(jsonb) from public, anon, authenticated;

-- 관리자 화면·확인용 상태(토큰은 내주지 않음)
create or replace function public.hr_onedrive_status() returns jsonb
language sql stable security definer set search_path to '' as $$
  select case when public.hr_is_admin() then jsonb_build_object(
    'connected', o.refresh_token is not null, 'account', o.account, 'folder', o.root_name,
    'last_run', o.last_run, 'last_error', o.last_error, 'last_result', o.last_result,
    'login_url', 'https://shlaohieozqanatatlzf.supabase.co/functions/v1/onedrive-sync/login?key=' || o.setup_key)
  else jsonb_build_object('connected', o.refresh_token is not null, 'last_run', o.last_run, 'last_error', o.last_error) end
  from public.hr_onedrive o where o.id = 1
$$;
revoke execute on function public.hr_onedrive_status() from public, anon;
grant execute on function public.hr_onedrive_status() to authenticated;

insert into public.hr_onedrive (id) values (1) on conflict (id) do nothing;

-- 5분마다 Edge Function 호출(pg_cron + pg_net). 함수가 연결 전이면 아무것도 하지 않는다.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('hr-onedrive-sync') where exists (select 1 from cron.job where jobname = 'hr-onedrive-sync');
select cron.schedule('hr-onedrive-sync', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://shlaohieozqanatatlzf.supabase.co/functions/v1/onedrive-sync/sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select cron_key from public.hr_onedrive where id = 1)),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$cron$);
