-- 업무 › 회의록 게시판 (2026-11-15). 팀원 누구나 읽기·작성, 수정·삭제는 작성자·관리자(공지사항과 같은 규칙).
create table if not exists public.hr_minutes (
  id bigint generated always as identity primary key,
  meet_date date not null default current_date,  -- 회의일
  kind text not null default '팀 회의',           -- 팀 회의·외부 회의·간담회·기타
  title text not null,
  place text not null default '',
  attendees text not null default '',            -- 팀원 이름(쉼표)
  guests text not null default '',               -- 외부 참석자
  agenda text not null default '',               -- 안건
  body text not null default '',                 -- 회의 내용(개조식)
  decisions text not null default '',            -- 결정 사항
  actions text not null default '',              -- 후속 조치(담당·기한)
  link text not null default '' check (link = '' or link ~* '^https?://'),  -- 관련 자료(원드라이브 등)
  author text not null default '',               -- 작성자 이름
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger hr_minutes_touch before update on public.hr_minutes for each row execute function public.hr_touch();
alter table public.hr_minutes enable row level security;
create policy hr_minutes_read on public.hr_minutes for select to authenticated using ((select public.hr_is_member()));
create policy hr_minutes_ins on public.hr_minutes for insert to authenticated
  with check ((select public.hr_is_member()) and lower(created_by) = (select public.hr_my_email()));
create policy hr_minutes_upd on public.hr_minutes for update to authenticated
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()))
  with check ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));
create policy hr_minutes_del on public.hr_minutes for delete to authenticated
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));

-- 사용 로그(관리자 › 사용 로그)에 회의록 추가·수정·삭제도 남긴다(표 이름표 '회의록' 추가)
create or replace function public.hr_audit() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  diff jsonb;
  label text := case tg_table_name
    when 'hr_leave' then '근태' when 'hr_notices' then '공지사항' when 'hr_weeks' then '주간업무 주차'
    when 'hr_weekly' then '팀주간업무' when 'hr_tasks' then '개인별업무' when 'hr_review' then '협의검토 입력'
    when 'hr_duty' then '업무분장' when 'hr_events' then '팀 일정' when 'hr_pc_log' then '공용 PC 사용대장'
    when 'hr_supply' then '사무용품 신청대장' when 'hr_minutes' then '회의록' else tg_table_name end;
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
                         r ->> 'title', r ->> 'meet_date', r ->> 'area', r ->> 'kind', r ->> 'start_date', r ->> 'req_date'), 200),
          case when tg_op = 'UPDATE' then diff else r end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger hr_audit after insert or update or delete on public.hr_minutes for each row execute function public.hr_audit();
