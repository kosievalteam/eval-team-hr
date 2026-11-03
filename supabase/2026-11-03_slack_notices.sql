-- 공지사항 ↔ Slack 전체공지 채널 양방향 연동 (2026-11-03). 배포.bat(publish.py)이 실행될 때 동기화한다.
-- Supabase 대시보드 › SQL Editor에 통째로 붙여 넣고 Run. 기존 데이터는 지우지 않는다.

-- HR앱 공지 → Slack: 게시된 Slack 메시지 ts. 연동 전에 쓴 공지는 Slack에 올리지 않는다.
alter table public.hr_notices add column slack_ts text;
update public.hr_notices set slack_ts = 'before-slack' where slack_ts is null;

-- Slack → HR앱: 채널 메시지 사본(배포 때마다 통째로 교체)
create table public.hr_slack_notices (
  ts text primary key,
  author text not null default '',
  text text not null default '',
  date date not null,
  edited boolean not null default false,
  reply_count int not null default 0,
  permalink text not null default ''
);
alter table public.hr_slack_notices enable row level security;
create policy hr_slack_notices_read on public.hr_slack_notices for select using ((select public.hr_is_member()));

create or replace function public.hr_check_token(p_token text) returns void
language plpgsql security definer set search_path to '' as $$
begin
  if not exists (select 1 from public.hr_upload_token t
                 where t.token_sha256 = encode(extensions.digest(p_token, 'sha256'), 'hex')) then
    raise exception 'invalid upload token' using errcode = '42501';
  end if;
end $$;

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

revoke execute on function public.hr_check_token(text) from public, anon, authenticated;
revoke execute on function public.hr_put_slack(text, jsonb) from public, authenticated;
revoke execute on function public.hr_notices_unposted(text) from public, authenticated;
revoke execute on function public.hr_notice_posted(text, uuid, text) from public, authenticated;
grant execute on function public.hr_put_slack(text, jsonb) to anon;
grant execute on function public.hr_notices_unposted(text) to anon;
grant execute on function public.hr_notice_posted(text, uuid, text) to anon;
